import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Production (Docker) sets DATABASE_URL to the SQLite file on the persistent
// volume; locally it falls back to the dev file in prisma/.
const dbPath = path.resolve(process.cwd(), 'prisma', 'dev.db')
const url = process.env.DATABASE_URL ?? `file:${dbPath}`

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: { url },
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
})
