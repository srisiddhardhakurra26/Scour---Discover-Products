import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@huggingface/transformers',
    'playwright',
    'playwright-core',
    // tesseract.js spawns a worker thread by file path; bundling rewrites the
    // path and breaks it. sharp ships native binaries.
    'tesseract.js',
    'sharp',
  ],
}

export default nextConfig
