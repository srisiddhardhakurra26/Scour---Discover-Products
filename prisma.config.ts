import path from 'node:path'
import { defineConfig } from 'prisma/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const dbPath = path.resolve(process.cwd(), 'prisma', 'dev.db')
const url = `file:${dbPath}`

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: { url },
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  adapter: async () => new PrismaBetterSqlite3({ url }),
})
