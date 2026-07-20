import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import path from 'node:path'

const url =
  process.env.DATABASE_URL ?? `file:${path.resolve(process.cwd(), 'prisma', 'dev.db')}`
const adapter = new PrismaBetterSqlite3({ url })
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
  // Demo-only sources stay off once real marketplace adapters are present.
  { type: 'mock', identifier: 'mock-ebay', label: 'eBay (mock)', enabled: false },
  { type: 'mock', identifier: 'mock-amazon', label: 'Amazon (mock)', enabled: false },
]

async function main() {
  for (const s of seeds) {
    const retailer = await prisma.retailer.upsert({
      where: { type_identifier: { type: s.type, identifier: s.identifier } },
      // Preserve the user's source toggles across restarts. Demo mocks are the
      // sole exception: they must stay off in a real installation.
      update: s.type === 'mock' ? { label: s.label, enabled: false } : { label: s.label },
      create: { type: s.type, identifier: s.identifier, label: s.label, enabled: s.enabled },
    })
    console.log(`✓ ${s.label} (${s.type}/${s.identifier}) enabled=${retailer.enabled}`)
  }

  // Remove demo data only. Disabling a real source is a reversible preference
  // and must not erase its history on the next restart.
  const disabled = await prisma.retailer.findMany({
    where: { enabled: false, type: 'mock' },
    select: { id: true, label: true },
  })
  if (disabled.length > 0) {
    const purged = await prisma.listing.deleteMany({
      where: { retailerId: { in: disabled.map((r) => r.id) } },
    })
    if (purged.count > 0) {
      console.log(`✓ purged ${purged.count} mock listings`)
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
