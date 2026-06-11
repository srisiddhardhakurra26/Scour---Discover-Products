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
   - **source-onboarder** — when an added domain isn't Shopify/Woo, the agent prefers schema.org/Product **JSON-LD** on the search page (`extraction: 'jsonld'`, immune to layout changes); otherwise an LLM derives CSS selectors from the real results page, verified before saving as a `generic-html` retailer. Bot-protected stores (403s/TLS kills, e.g. lululemon) fail fast with `blocked: true`.
   - **adapter-repair** — when a `generic-html` source returns 0 results, repair tries JSON-LD first, then an LLM re-derives a fixed config from re-rendered HTML, verified by actually extracting listings. Fires automatically at search time (once per source, guarded) or manually from `/sources`.
   - **vision-locate** (`vision-locate.ts`) — last-resort stage of onboarding/repair: Playwright screenshots the rendered page, Gemini Flash vision reads the exact title/price strings of visible cards, those strings are anchored in the DOM, and selectors are generalized from the real nodes. Beats HTML-only derivation on hashed/obfuscated class names.
   - **requery** — a store whose first pass kept 0 listings gets one retry with a query reformulated in that store's vocabulary ("leather shoes" → "chelsea boot"); results still ranked against the original query. Cached per (store, query).
   - **cluster-judge** — for cosine matches in the 0.78–0.86 gray band, asks for a same-product verdict (Gemini vision with both product images when fetchable, else text). Advisory: when unavailable, the plain 0.82 threshold decides.
4. **Background enrichment** (`src/lib/enrich.ts`, queue drained off the search path): one image fetch per listing feeds a perceptual hash (`imageHash`, dHash via sharp — ADR-009 clustering signal, applied as a late merge to singleton clusters) and OCR'd spec text (`ocrText`, tesseract.js, confidence-gated ≥70 to reject junk reads of stylized photos).
5. **Source watchdog** (`src/lib/watchdog.ts`, scheduled daily from instrumentation): probes each `generic-html` source with canary queries, auto-repairs stale selectors, and persists `SourceHealth` history rendered as the dot strip in `/sources`. `WATCHDOG_DISABLED=1` / `WATCHDOG_INTERVAL_MS` to control; `ENRICH_DISABLED=1` / `ENRICH_OCR_DISABLED=1` for enrichment.

## Read before writing code

- [docs/00-vision.md](docs/00-vision.md) — what Scour is and isn't
- [docs/01-features.md](docs/01-features.md) — tiered feature list (= build order)
- [docs/02-architecture.md](docs/02-architecture.md) — data model, fan-out, embeddings
- [docs/03-decisions.md](docs/03-decisions.md) — ADRs (every "we chose X because Y")

### Where the code diverges from the docs

- **Matching is text-first, with an exact-photo signal.** No image/CLIP embeddings — that idea stays dropped, and `Listing.imageEmbedding` remains unused; don't build on it. ADR-009 added perceptual hashing (`Listing.imageHash`) as a same-photo clustering signal — exact-duplicate detection, not semantic similarity. (Supersedes the "image primary" claim in `docs/02` and ADR-003.)
- **Stores actually built:** eBay, Amazon, Etsy, Best Buy, Shopify, WooCommerce, Reddit, Slickdeals (RSS), `generic-html` (LLM-onboarded), plus mock adapters. Temu / Shein / AliExpress / Walmart from the docs are **not** built.
- **The LLM agent layer above is new** and isn't described in the docs.

## Hard constraints — don't violate without a new ADR

- **No unified checkout.** Always deep-link to the retailer. Acting as merchant of record requires per-retailer agreements we don't have.
- **User-addable sources are storefront domains, not arbitrary URLs.** A user supplies a domain; Scour fetches only that domain's own pages (`/products.json`, the Woo Store API, or its homepage/search page for the onboarder). Never fetch user-supplied arbitrary URLs server-side — SSRF risk.
- **Embeddings stay local.** `@huggingface/transformers` in-process; no external embedding API in the hot path.
- **External LLM calls must degrade gracefully.** Groq/Gemini power query-parsing/onboarding/repair, but they're cached, time-boxed, and optional — search must still work when the LLM is unavailable. Never put an un-fallback'd LLM call on the critical path.
- **Progressive rendering on search.** Fan-out is slow; never block the UI on the slowest adapter.

## Stack baseline

Next.js 16, React 19, Prisma 7 + SQLite (better-sqlite3), TypeScript, `@huggingface/transformers` (local embeddings), `cheerio` + `playwright` (scraping), `sharp` + `tesseract.js` (image enrichment, local), `rss-parser`, and a small Groq/Gemini JSON+vision client (`GROQ_API_KEY` / `GEMINI_API_KEY`; optional `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` switch the Reddit adapter to the official OAuth API). Same core as FeedHub — author has muscle memory here.
