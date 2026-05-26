# Scour

**Scour discovers products across major shopping platforms and compares them side by side.**

The architectural pattern mirrors [FeedHub](https://github.com/srisiddhardhakurra26/feedhub) (the author's content aggregator), applied to shopping:

| FeedHub                | Scour                                                              |
|------------------------|--------------------------------------------------------------------|
| Source (RSS, social)   | Retailer (Amazon, AliExpress, Temu, Shein, Shopify storefronts...) |
| Item (article)         | Listing (a SKU on a specific retailer)                             |
| Story (clustered items)| Product (clustered listings — same thing, different sellers)       |
| HF text embeddings     | HF text **+ image (CLIP)** embeddings                              |

## Status

Early design phase. No code yet. Design decisions live in `docs/`.

## Read before writing code

- [docs/00-vision.md](docs/00-vision.md) — what Scour is and isn't
- [docs/01-features.md](docs/01-features.md) — tiered feature list (= build order)
- [docs/02-architecture.md](docs/02-architecture.md) — data model, fan-out, embeddings
- [docs/03-decisions.md](docs/03-decisions.md) — ADRs (every "we chose X because Y")

## Hard constraints — don't violate without a new ADR

- **No unified checkout.** Always deep-link to the retailer. Acting as merchant of record requires per-retailer agreements we don't have.
- **No arbitrary-URL user scraping.** SSRF risk. User-addable sources are limited to whitelisted patterns (currently: Shopify storefront `/products.json`).
- **Local ML only at v1.** `@huggingface/transformers` in-process. No external embedding APIs in the hot path.
- **Progressive rendering on search.** Fan-out is slow; never block the UI on the slowest adapter.

## Stack baseline

Next.js 16, React 19, Prisma 7 + SQLite (better-sqlite3), TypeScript, `@huggingface/transformers`, `rss-parser`, `zod`. Same as FeedHub — author has muscle memory here.
