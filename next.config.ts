import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
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
