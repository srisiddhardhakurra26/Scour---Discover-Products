// One-shot script: wipe Product table, re-embed every Listing using normalized
// titles, then re-cluster from scratch using the same logic as src/lib/cluster.ts.
// Run with: npm run db:recluster

import 'dotenv/config'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { pipeline } from '@huggingface/transformers'
import { normalizeTitle, extractASIN } from '../src/lib/text'

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const EMBEDDING_DIM = 384
const SIMILARITY_THRESHOLD = 0.82
const PRICE_RATIO_LOW = 0.25
const PRICE_RATIO_HIGH = 4.0

function floatToBytes(arr: Float32Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(arr.byteLength)
  out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength))
  return out
}

function bytesToFloat(bytes: Uint8Array | Buffer): Float32Array {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Float32Array(copy.buffer)
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function centroid(embeds: Float32Array[]): Float32Array {
  const sum = new Float32Array(EMBEDDING_DIM)
  for (const e of embeds) for (let i = 0; i < EMBEDDING_DIM; i++) sum[i] += e[i]
  let n = 0
  for (let i = 0; i < EMBEDDING_DIM; i++) n += sum[i] * sum[i]
  n = Math.sqrt(n) || 1
  for (let i = 0; i < EMBEDDING_DIM; i++) sum[i] /= n
  return sum
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function priceFits(price: number, clusterPrices: number[]): boolean {
  if (price <= 0) return true
  const valid = clusterPrices.filter((p) => p > 0)
  if (valid.length === 0) return true
  const m = median(valid)
  if (m <= 0) return true
  const r = price / m
  return r >= PRICE_RATIO_LOW && r <= PRICE_RATIO_HIGH
}

async function main() {
  const dbPath = path.resolve(process.cwd(), 'prisma', 'dev.db')
  const url = process.env.DATABASE_URL || `file:${dbPath}`
  const adapter = new PrismaBetterSqlite3({ url })
  const prisma = new PrismaClient({ adapter })

  console.log('Loading embedding model (cached on disk after first run)…')
  const extractor = await pipeline('feature-extraction', MODEL_ID)

  console.log('Wiping existing Products + Listing embeddings…')
  await prisma.product.deleteMany()
  await prisma.listing.updateMany({
    data: { productId: null, textEmbedding: null },
  })

  const listings = await prisma.listing.findMany({
    orderBy: { capturedAt: 'asc' },
    select: { id: true, title: true, url: true, imageUrl: true, priceMinor: true },
  })
  console.log(`Re-embedding + reclustering ${listings.length} listings…`)

  let processed = 0
  let asinAttached = 0
  let cosineAttached = 0
  let priceRejected = 0
  let created = 0

  for (const listing of listings) {
    const normalized = normalizeTitle(listing.title)
    if (!normalized) {
      processed++
      continue
    }
    const out = (await extractor(normalized, { pooling: 'mean', normalize: true })) as {
      data: Float32Array
    }
    const embedding = out.data

    await prisma.listing.update({
      where: { id: listing.id },
      data: { textEmbedding: floatToBytes(embedding) },
    })

    // Pass 1: ASIN exact match
    const asin = extractASIN(listing.url)
    let attached = false
    if (asin) {
      const sibling = await prisma.listing.findFirst({
        where: {
          id: { not: listing.id },
          productId: { not: null },
          url: { contains: asin },
        },
        select: { productId: true },
      })
      if (sibling?.productId) {
        await prisma.listing.update({
          where: { id: listing.id },
          data: { productId: sibling.productId },
        })
        attached = true
        asinAttached++
      }
    }

    // Pass 2: cosine + price sanity
    if (!attached) {
      const products = await prisma.product.findMany({
        select: {
          id: true,
          listings: { select: { textEmbedding: true, priceMinor: true } },
        },
      })

      let best: { id: string; sim: number; prices: number[] } | null = null
      for (const p of products) {
        const embeds = p.listings
          .map((l) => (l.textEmbedding ? bytesToFloat(l.textEmbedding) : null))
          .filter((v): v is Float32Array => v !== null && v.length === EMBEDDING_DIM)
        if (embeds.length === 0) continue
        const c = centroid(embeds)
        const sim = dot(embedding, c)
        if (!best || sim > best.sim) {
          best = { id: p.id, sim, prices: p.listings.map((l) => l.priceMinor) }
        }
      }

      if (best && best.sim >= SIMILARITY_THRESHOLD) {
        if (priceFits(listing.priceMinor, best.prices)) {
          await prisma.listing.update({
            where: { id: listing.id },
            data: { productId: best.id },
          })
          attached = true
          cosineAttached++
        } else {
          priceRejected++
        }
      }
    }

    if (!attached) {
      const now = new Date()
      const product = await prisma.product.create({
        data: {
          canonicalTitle: listing.title,
          canonicalImage: listing.imageUrl,
          firstSeenAt: now,
          lastSeenAt: now,
          listingCount: 0,
          retailerCount: 0,
        },
      })
      await prisma.listing.update({
        where: { id: listing.id },
        data: { productId: product.id },
      })
      created++
    }

    processed++
    if (processed % 50 === 0) {
      process.stdout.write(`  ${processed}/${listings.length}\n`)
    }
  }

  // Recompute aggregates for all products
  console.log('Recomputing Product aggregates…')
  const allProducts = await prisma.product.findMany({ select: { id: true } })
  for (const p of allProducts) {
    const listings = await prisma.listing.findMany({
      where: { productId: p.id },
      select: { retailerId: true },
    })
    const retailerCount = new Set(listings.map((l) => l.retailerId)).size
    await prisma.product.update({
      where: { id: p.id },
      data: {
        listingCount: listings.length,
        retailerCount,
        lastSeenAt: new Date(),
      },
    })
  }

  const total = await prisma.product.count()
  const multi = await prisma.product.count({ where: { retailerCount: { gte: 2 } } })
  const singletons = total - multi

  console.log('\n--- Recluster done ---')
  console.log(`  ASIN-attached:   ${asinAttached}`)
  console.log(`  Cosine-attached: ${cosineAttached}`)
  console.log(`  Price-rejected:  ${priceRejected}`)
  console.log(`  New products:    ${created}`)
  console.log(`  Total products:  ${total} (${multi} multi-retailer, ${singletons} singleton)`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
