import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { repairGenericAdapter } from '../src/lib/llm/adapter-repair'
import type { GenericHtmlConfig } from '../src/lib/llm/source-onboarder'

// Load .env.local manually since dotenv/config reads .env by default.
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    if (!process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const dbPath = path.resolve(process.cwd(), 'prisma', 'dev.db')
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` })
const prisma = new PrismaClient({ adapter })

async function main() {
  const r = await prisma.retailer.findFirst({ where: { identifier: 'nike.com' } })
  if (!r) throw new Error('nike.com retailer not found')
  if (!r.config) throw new Error('no config on nike.com')

  const config = JSON.parse(r.config) as GenericHtmlConfig
  console.log('Current searchUrlTemplate:', config.searchUrlTemplate)
  console.log('Running repair agent (this will take 30-60s)...')

  const fixed = await repairGenericAdapter(r.identifier, config, 'air max')
  if (!fixed) {
    console.error('Repair returned null. Check logs above.')
    process.exit(1)
  }

  console.log('\nFixed config:')
  console.log(JSON.stringify(fixed, null, 2))

  await prisma.retailer.update({
    where: { id: r.id },
    data: { config: JSON.stringify(fixed), lastError: null },
  })
  console.log('\nSaved.')
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err)
    return prisma.$disconnect().then(() => process.exit(1))
  })
