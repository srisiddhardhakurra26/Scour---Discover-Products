import path from 'node:path'
import { defineConfig } from 'prisma/config'

const dbPath = path.resolve(process.cwd(), 'prisma', 'dev.db')
const url = `file:${dbPath}`

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: { url },
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
})
