// One-shot repair for legacy Product clusters. It preserves one representative
// listing (and therefore the existing Product id) per cluster, detaches unsafe
// same-retailer or identity-incompatible members, then feeds only those rows
// through the current conservative batch clusterer.
//
// Run with: npm run db:recluster

import 'dotenv/config'
import { clusterListingBatch, identityCompatible, updateProductAggregates } from '../src/lib/cluster'
import { prisma } from '../src/lib/db'
import { bytesToFloat, EMBEDDING_DIM, embedTexts, floatToBytes } from '../src/lib/embeddings'
import { normalizeTitle } from '../src/lib/text'

type ListingRow = {
  id: string
  retailerId: string
  title: string
  textEmbedding: Uint8Array | null
}

function chooseKeeper(
  canonicalTitle: string,
  listings: ListingRow[],
): ListingRow {
  return (
    listings.find((listing) => normalizeTitle(listing.title) === normalizeTitle(canonicalTitle)) ??
    listings.find((listing) => identityCompatible(canonicalTitle, listing.title)) ??
    listings[0]
  )
}

async function ensureEmbeddings(listings: ListingRow[]): Promise<Map<string, Float32Array>> {
  const vectors = new Map<string, Float32Array>()
  const missing: ListingRow[] = []
  for (const listing of listings) {
    const vector = listing.textEmbedding ? bytesToFloat(listing.textEmbedding) : undefined
    if (vector?.length === EMBEDDING_DIM) vectors.set(listing.id, vector)
    else missing.push(listing)
  }

  const batchSize = 64
  for (let offset = 0; offset < missing.length; offset += batchSize) {
    const batch = missing.slice(offset, offset + batchSize)
    const embedded = await embedTexts(batch.map((listing) => normalizeTitle(listing.title)))
    for (let index = 0; index < batch.length; index += 1) {
      const vector = embedded[index]
      if (!(vector instanceof Float32Array) || vector.length !== EMBEDDING_DIM) continue
      vectors.set(batch[index].id, vector)
      await prisma.listing.update({
        where: { id: batch[index].id },
        data: { textEmbedding: floatToBytes(vector) },
      })
    }
  }
  return vectors
}

async function main() {
  const products = await prisma.product.findMany({
    orderBy: { firstSeenAt: 'asc' },
    select: {
      id: true,
      canonicalTitle: true,
      listings: {
        orderBy: { capturedAt: 'asc' },
        select: {
          id: true,
          retailerId: true,
          title: true,
          textEmbedding: true,
        },
      },
    },
  })

  const detached: ListingRow[] = []
  const touchedProducts = new Set<string>()
  for (const product of products) {
    if (product.listings.length <= 1) continue
    const keeper = chooseKeeper(product.canonicalTitle, product.listings)
    const seenRetailers = new Set([keeper.retailerId])
    for (const listing of product.listings) {
      if (listing.id === keeper.id) continue
      if (
        seenRetailers.has(listing.retailerId) ||
        !identityCompatible(keeper.title, listing.title)
      ) {
        detached.push(listing)
        touchedProducts.add(product.id)
      } else {
        seenRetailers.add(listing.retailerId)
      }
    }
  }

  if (detached.length === 0) {
    console.log('All Product clusters already satisfy conservative identity rules.')
    return
  }

  console.log(`Detaching ${detached.length} unsafe offers from ${touchedProducts.size} clusters…`)
  const chunkSize = 200
  for (let offset = 0; offset < detached.length; offset += chunkSize) {
    await prisma.listing.updateMany({
      where: { id: { in: detached.slice(offset, offset + chunkSize).map((listing) => listing.id) } },
      data: { productId: null },
    })
  }
  for (const productId of touchedProducts) await updateProductAggregates(productId)

  console.log('Ensuring detached offers have local embeddings…')
  const vectors = await ensureEmbeddings(detached)
  const byRetailer = new Map<string, ListingRow[]>()
  for (const listing of detached) {
    byRetailer.set(listing.retailerId, [
      ...(byRetailer.get(listing.retailerId) ?? []),
      listing,
    ])
  }

  let reclustered = 0
  for (const [retailerId, listings] of byRetailer) {
    const entries = listings.flatMap((listing) => {
      const embedding = vectors.get(listing.id)
      return embedding ? [{ listingId: listing.id, embedding }] : []
    })
    reclustered += await clusterListingBatch(entries)
    console.log(`  ${retailerId}: ${entries.length} offers`)
  }

  const orphaned = await prisma.listing.count({ where: { productId: null } })
  const remainingSameRetailerClusters = await prisma.$queryRaw<
    Array<{ count: bigint }>
  >`
    SELECT COUNT(*) AS count
    FROM (
      SELECT l.productId, l.retailerId
      FROM Listing l
      WHERE l.productId IS NOT NULL
      GROUP BY l.productId, l.retailerId
      HAVING COUNT(*) > 1
    )
  `

  console.log('\n--- Conservative recluster complete ---')
  console.log(`  Reclustered offers: ${reclustered}`)
  console.log(`  Orphaned listings:  ${orphaned}`)
  console.log(
    `  Duplicate retailer/product groups: ${Number(remainingSameRetailerClusters[0]?.count ?? 0n)}`,
  )
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
