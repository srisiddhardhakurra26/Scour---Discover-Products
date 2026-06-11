import { prisma } from '@/lib/db'
import type { NormalizedListing } from './adapters/types'
import { embedTexts, floatToBytes } from './embeddings'
import { clusterListing } from './cluster'
import { enqueueEnrichment } from './enrich'
import { normalizeTitle } from './text'

export type PersistResult = {
  upserts: number
  priceObservations: number
  embedded: number
  clustered: number
}

export async function persistListings(
  retailerId: string,
  listings: NormalizedListing[],
  precomputedEmbeddings?: Float32Array[],
): Promise<PersistResult> {
  if (listings.length === 0) {
    await markFetched(retailerId)
    return { upserts: 0, priceObservations: 0, embedded: 0, clustered: 0 }
  }

  const existingRows = await prisma.listing.findMany({
    where: {
      retailerId,
      externalId: { in: listings.map((l) => l.externalId) },
    },
    select: {
      id: true,
      externalId: true,
      priceMinor: true,
      title: true,
      textEmbedding: true,
    },
  })
  const existingByExt = new Map(existingRows.map((r) => [r.externalId, r]))

  let upserts = 0
  let priceObservations = 0

  type EmbedTarget = { listingId: string; index: number; needsFreshEmbed: boolean }
  const targets: EmbedTarget[] = []
  const batchIds: string[] = []

  for (let i = 0; i < listings.length; i++) {
    const l = listings[i]
    const prior = existingByExt.get(l.externalId)
    const data = {
      title: l.title,
      url: l.url,
      imageUrl: l.imageUrl,
      priceMinor: l.priceMinor,
      currency: l.currency,
      shippingMinor: l.shippingMinor,
      availability: l.availability,
      sellerName: l.sellerName,
      sellerRating: l.sellerRating,
      reviewCount: l.reviewCount,
      reviewAvg: l.reviewAvg,
      raw: l.raw ? JSON.stringify(l.raw) : undefined,
      detailsText: l.detailsText,
      lastSeenAt: new Date(),
    }

    const listing = await prisma.listing.upsert({
      where: { retailerId_externalId: { retailerId, externalId: l.externalId } },
      update: data,
      create: { retailerId, externalId: l.externalId, ...data },
    })
    upserts++
    batchIds.push(listing.id)

    const priceChanged = !prior || prior.priceMinor !== l.priceMinor
    if (priceChanged && l.priceMinor > 0) {
      await prisma.priceObservation.create({
        data: { listingId: listing.id, priceMinor: l.priceMinor, currency: l.currency },
      })
      priceObservations++
    }

    const titleChanged = prior && prior.title !== l.title
    const noEmbedding = !prior || !prior.textEmbedding
    if (noEmbedding || titleChanged) {
      targets.push({ listingId: listing.id, index: i, needsFreshEmbed: !precomputedEmbeddings })
    }
  }

  await markFetched(retailerId)

  let embedded = 0
  let clustered = 0
  if (targets.length > 0) {
    try {
      let vectors: Float32Array[]
      if (precomputedEmbeddings) {
        vectors = targets.map((t) => precomputedEmbeddings[t.index])
      } else {
        vectors = await embedTexts(
          targets.map((t) => normalizeTitle(listings[t.index].title)),
        )
      }
      for (let j = 0; j < targets.length; j++) {
        const { listingId } = targets[j]
        const vec = vectors[j]
        await prisma.listing.update({
          where: { id: listingId },
          data: { textEmbedding: floatToBytes(vec) },
        })
        embedded++
        try {
          await clusterListing(listingId, vec)
          clustered++
        } catch (err) {
          console.error(`[cluster] listing=${listingId}:`, err)
        }
      }
    } catch (err) {
      console.error('[embed]', err)
    }
  }

  // Background image enrichment (pHash + OCR) — fire-and-forget, after
  // clustering so the late hash-merge sees this batch's product assignments.
  enqueueEnrichment(batchIds)

  return { upserts, priceObservations, embedded, clustered }
}

async function markFetched(retailerId: string) {
  await prisma.retailer.update({
    where: { id: retailerId },
    data: { lastFetchedAt: new Date(), lastError: null },
  })
}

export async function recordAdapterError(retailerId: string, message: string) {
  await prisma.retailer.update({
    where: { id: retailerId },
    data: { lastFetchedAt: new Date(), lastError: message.slice(0, 500) },
  })
}
