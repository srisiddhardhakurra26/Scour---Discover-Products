# syntax=docker/dockerfile:1

# ---- build: install deps, generate Prisma client, build Next, cache model ----
FROM node:22-bookworm AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
# Best-effort: bake the embedding model into the image so the first search
# doesn't wait on a download. Non-fatal — if it fails, the app fetches the
# model once at runtime instead.
RUN node -e "import('@huggingface/transformers').then(({pipeline})=>pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2')).then(()=>console.log('model cached')).catch(e=>console.error('prewarm skipped:',e.message))"

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_NO_SANDBOX=1 \
    PORT=3000

# Copy the fully-built app + node_modules: native modules (better-sqlite3,
# onnxruntime), the generated Prisma client, and the cached model. We
# deliberately avoid Next "standalone" output — it doesn't trace the ONNX model
# files or the Chromium binary, and this app needs both at runtime.
COPY --from=build /app /app

# Install the Chromium build matching the project's Playwright version, plus its
# system libraries. Baked into the image at PLAYWRIGHT_BROWSERS_PATH.
RUN npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*

RUN install -m 0755 /app/docker-entrypoint.sh /usr/local/bin/scour-entrypoint

EXPOSE 3000
ENTRYPOINT ["scour-entrypoint"]
