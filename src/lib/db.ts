import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient() {
  // Local dev uses the file in prisma/; production (Docker) sets DATABASE_URL
  // to the SQLite file on the persistent volume, e.g. file:/data/scour.db.
  const url =
    process.env.DATABASE_URL ?? `file:${path.resolve(process.cwd(), 'prisma', 'dev.db')}`
  const adapter = new PrismaBetterSqlite3({ url })
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
