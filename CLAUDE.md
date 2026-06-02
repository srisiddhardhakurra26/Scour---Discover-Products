# Scour

**Scour discovers products across major shopping platforms and compares them side by side.**

The architectural pattern mirrors [FeedHub](https://github.com/srisiddhardhakurra26/feedhub) (the author's content aggregator), applied to shopping:

| FeedHub                | Scour                                                              |
|------------------------|--------------------------------------------------------------------|
| Source (RSS, social)   | Retailer (eBay, Amazon, Etsy, Best Buy, Shopify/Woo storefronts…)  |
| Item (article)         | Listing (a SKU on a specific retailer)                             |
| Story (clustered items)| Product (clustered listings — same thing, different sellers)       |
| HF text embeddings     | HF text embeddings (`all-MiniLM-L6-v2`, 384-dim)                  |

A "source" is a `Retailer` row (stored config); an "adapter" is the code that queries it. One source = one adapter instance, built from the row by `src/lib/adapters/registry.ts`.

## Status

Working app, well past the original design phase (~5k LOC). Home (`/`), search (`/search`), and source management (`/sources`) all function. The `docs/` capture the **original** design intent — read them for the "why," but trust the code over the docs where they diverge (see below).

## How it works

1. **Fan-out.** A query hits all enabled adapters in parallel, each with a 4s timeout (`ADAPTER_TIMEOUT_MS`). Results stream into the UI via React Suspense; a slow/dead adapter never blocks the rest.
2. **Embed + cluster.** Each listing title → a normalized 384-dim vector (local HF transformers, `src/lib/embeddings.ts`). `src/lib/cluster.ts` attaches a listing to an existing Product via ASIN exact-match (fast path) or cosine ≥ `0.82` plus a price-ratio guardrail (0.25×–4× cluster median); otherwise it starts a new Product.
3. **LLM agent layer** (`src/lib/llm/`, shared client = Groq Llama first, Gemini fallback, JSON mode, temp 0):
   - **query-parser** — turns `"wireless earbuds under $80"` into `{refinedQuery, maxPriceMinor, brand, features}`. The clean `refinedQuery` is what gets embedded/searched; price/brand become hard filters. Cached; on failure falls back to the raw query.
   - **source-onboarder** — when an added domain isn't Shopify/Woo, an LLM derives a scraper config (search-URL pattern, then CSS selectors from the real results page), verified before saving as a `generic-html` retailer.
   - **adapter-repair** — when a `generic-html` source returns 0 results, an LLM re-derives a fixed config from re-rendered HTML, verified by actually extracting listings. Fires automatically at search time (once per source, guarded) or manually from `/sources`.

## Read before writing code

- [docs/00-vision.md](docs/00-vision.md) — what Scour is and isn't
- [docs/01-features.md](docs/01-features.md) — tiered feature list (= build order)
- [docs/02-architecture.md](docs/02-architecture.md) — data model, fan-out, embeddings
- [docs/03-decisions.md](docs/03-decisions.md) — ADRs (every "we chose X because Y")

### Where the code diverges from the docs

- **Matching is text-only.** No image/CLIP embeddings — that idea is dropped. `Listing.imageEmbedding` exists in the schema but is unused; don't build on it. (Supersedes the "image primary" claim in `docs/02` and ADR-003.)
- **Stores actually built:** eBay, Amazon, Etsy, Best Buy, Shopify, WooCommerce, Reddit, Slickdeals (RSS), `generic-html` (LLM-onboarded), plus mock adapters. Temu / Shein / AliExpress / Walmart from the docs are **not** built.
- **The LLM agent layer above is new** and isn't described in the docs.

## Hard constraints — don't violate without a new ADR

- **No unified checkout.** Always deep-link to the retailer. Acting as merchant of record requires per-retailer agreements we don't have.
- **User-addable sources are storefront domains, not arbitrary URLs.** A user supplies a domain; Scour fetches only that domain's own pages (`/products.json`, the Woo Store API, or its homepage/search page for the onboarder). Never fetch user-supplied arbitrary URLs server-side — SSRF risk.
- **Embeddings stay local.** `@huggingface/transformers` in-process; no external embedding API in the hot path.
- **External LLM calls must degrade gracefully.** Groq/Gemini power query-parsing/onboarding/repair, but they're cached, time-boxed, and optional — search must still work when the LLM is unavailable. Never put an un-fallback'd LLM call on the critical path.
- **Progressive rendering on search.** Fan-out is slow; never block the UI on the slowest adapter.

## Stack baseline

Next.js 16, React 19, Prisma 7 + SQLite (better-sqlite3), TypeScript, `@huggingface/transformers` (local embeddings), `cheerio` + `playwright` (scraping), `rss-parser`, and a small Groq/Gemini JSON client (`GROQ_API_KEY` / `GEMINI_API_KEY`). Same core as FeedHub — author has muscle memory here.
