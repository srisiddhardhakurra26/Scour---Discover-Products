import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import path from 'node:path'

const dbPath = path.resolve(process.cwd(), 'prisma', 'dev.db')
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` })
const prisma = new PrismaClient({ adapter })

type Seed = { type: string; identifier: string; label: string; enabled: boolean }

const seeds: Seed[] = [
  // Shopify storefronts (real, no creds)
  { type: 'shopify', identifier: 'www.allbirds.com', label: 'Allbirds', enabled: true },
  { type: 'shopify', identifier: 'www.deathwishcoffee.com', label: 'Death Wish Coffee', enabled: true },

  // Deal aggregators (no creds)
  { type: 'rss', identifier: 'slickdeals.net', label: 'Slickdeals', enabled: true },

  // Reddit deal subs (no creds, just need User-Agent)
  { type: 'reddit', identifier: 'buildapcsales', label: 'r/buildapcsales', enabled: true },
  { type: 'reddit', identifier: 'frugalmalefashion', label: 'r/frugalmalefashion', enabled: true },
  { type: 'reddit', identifier: 'gamedeals', label: 'r/GameDeals', enabled: true },
  { type: 'reddit', identifier: 'deals', label: 'r/deals', enabled: true },

  // Real marketplaces (env-gated; adapter returns null if creds missing → silently absent)
  { type: 'ebay', identifier: 'ebay', label: 'eBay', enabled: true },
  { type: 'etsy', identifier: 'etsy', label: 'Etsy', enabled: true },
  { type: 'bestbuy', identifier: 'bestbuy', label: 'Best Buy', enabled: true },
  { type: 'amazon', identifier: 'amazon', label: 'Amazon', enabled: true },

  // Mocks (for clustering demo)
  { type: 'mock', identifier: 'mock-ebay', label: 'eBay (mock)', enabled: true },
  // Disabled: replaced by the real Amazon adapter above.
  { type: 'mock', identifier: 'mock-amazon', label: 'Amazon (mock)', enabled: false },
]

async function main() {
  for (const s of seeds) {
    await prisma.retailer.upsert({
      where: { type_identifier: { type: s.type, identifier: s.identifier } },
      update: { label: s.label, enabled: s.enabled },
      create: { type: s.type, identifier: s.identifier, label: s.label, enabled: s.enabled },
    })
    console.log(`✓ ${s.label} (${s.type}/${s.identifier}) enabled=${s.enabled}`)
  }

  // Purge listings tied to retailers that are now disabled. Without this,
  // clusters keep pointing at stale data (e.g. mock-amazon search URLs after
  // we switched to the real Amazon scraper).
  const disabled = await prisma.retailer.findMany({
    where: { enabled: false },
    select: { id: true, label: true },
  })
  if (disabled.length > 0) {
    const purged = await prisma.listing.deleteMany({
      where: { retailerId: { in: disabled.map((r) => r.id) } },
    })
    if (purged.count > 0) {
      console.log(`✓ purged ${purged.count} listings from ${disabled.length} disabled retailer(s)`)
    }
    // Drop products that no longer have any listings.
    const orphans = await prisma.product.findMany({
      where: { listings: { none: {} } },
      select: { id: true },
    })
    if (orphans.length > 0) {
      await prisma.product.deleteMany({ where: { id: { in: orphans.map((p) => p.id) } } })
      console.log(`✓ removed ${orphans.length} orphan product(s)`)
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err)
    return prisma.$disconnect().then(() => process.exit(1))
  })
