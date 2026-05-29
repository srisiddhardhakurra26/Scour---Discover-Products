import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['@huggingface/transformers', 'playwright', 'playwright-core'],
}

export default nextConfig
