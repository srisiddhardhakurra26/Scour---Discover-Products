# Scour

Discover products across major shopping platforms and compare them side by side — no unified checkout, always a deep link to the real retailer.

**Status:** working app (~5k LOC), well past the original design phase. Search, source management, wishlist, and an AI shopping copilot all function today.

## What it does

- Type a query → Scour fans it out to every enabled retailer adapter in parallel (eBay, Amazon, Etsy, Best Buy, Shopify/WooCommerce storefronts, Reddit, Slickdeals, plus LLM-onboarded generic sites) and streams results in as they arrive.
- The same product listed on different retailers is clustered into one card with prices side by side, using local text embeddings (+ an exact-photo signal) rather than trusting brand/model text alone.
- Add a storefront domain as a new source; an LLM agent figures out how to scrape it (or repairs it later if it breaks).
- Save products to a wishlist and set a price-drop alert.
- Ask the built-in AI copilot shopping questions — it's grounded in your current search/wishlist context and streams its answer.

## Routes

| Route        | Purpose                                                        |
|--------------|------------------------------------------------------------------|
| `/`          | Home / query entry                                               |
| `/search`    | Fan-out search results, streamed via React Suspense               |
| `/sources`   | Add, enable/disable, and monitor retailer sources (health history) |
| `/wishlist`  | Saved products with optional price-drop alerts                    |

Plus `POST /api/copilot` — a streaming chat endpoint for the shopping assistant.

## Quick start

```bash
npm install
cp .env.example .env   # add whichever keys you have — missing ones are skipped, not fatal
npx prisma migrate dev
npm run db:seed        # seeds default retailer sources
npm run dev
```

Open http://localhost:3000 and run a search.

### Environment variables

None are required to boot — adapters and features degrade gracefully when a key is missing.

| Variable                                  | Enables                                                          |
|--------------------------------------------|-------------------------------------------------------------------|
| `EBAY_APP_ID` / `EBAY_CERT_ID`             | eBay adapter                                                       |
| `ETSY_API_KEY`                             | Etsy adapter                                                       |
| `BESTBUY_API_KEY`                          | Best Buy adapter                                                   |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`| Reddit adapter via official OAuth API (falls back to public JSON) |
| `GROQ_API_KEY` / `GEMINI_API_KEY`          | LLM layer: query parsing, source onboarding/repair, cluster judging, copilot chat (Groq first, Gemini fallback) |
| `WATCHDOG_DISABLED` / `WATCHDOG_INTERVAL_MS` | Toggle/tune the daily source-health watchdog                    |
| `ENRICH_DISABLED` / `ENRICH_OCR_DISABLED`  | Toggle background image-hash / OCR enrichment                     |
| `DATABASE_URL`                             | Override the SQLite location (defaults to a local file)           |

## How it works

1. **Fan-out.** A query hits all enabled adapters in parallel with a per-adapter timeout, so one slow/dead source never blocks the rest.
2. **Embed + cluster.** Each listing title becomes a local 384-dim embedding (`@huggingface/transformers`, no external API). Listings join a `Product` via exact ID match, cosine similarity, or a perceptual image-hash match; ambiguous cases get an LLM "same product?" verdict.
3. **LLM agent layer.** Groq/Gemini-backed helpers parse queries into structured filters, onboard new storefront domains by deriving scrapers (HTML/JSON-LD/vision as a last resort), and repair sources automatically when they go stale.
4. **Background enrichment.** Off the search path, listings get an image hash and OCR'd spec text to strengthen future clustering.
5. **Source watchdog.** A daily job probes every source with canary queries and auto-repairs broken selectors; history shows up as the health dots on `/sources`.

See [CLAUDE.md](CLAUDE.md) for the full technical deep-dive (data model, matching thresholds, hard constraints).

## Docs

The original design docs — useful for the "why," though the code has moved past them in places (see CLAUDE.md's "where the code diverges from the docs"):

- [Vision](docs/00-vision.md)
- [Features](docs/01-features.md)
- [Architecture](docs/02-architecture.md)
- [Decisions](docs/03-decisions.md)

## Deployment

See [DEPLOY.md](DEPLOY.md) — Docker Compose + Caddy on a single always-free Oracle Cloud VM, with auto-deploy on `git push`.

## Stack

Next.js 16, React 19, Prisma 7 + SQLite, TypeScript, local HF embeddings, Playwright/Cheerio scraping, sharp + tesseract.js image enrichment, Groq/Gemini for the LLM layer.

## License

TBD.
