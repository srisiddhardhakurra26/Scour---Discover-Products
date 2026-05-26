# Architectural Decision Records (ADRs)

Lightweight ADRs. New decisions get appended; old ones are kept (mark `Superseded` if revised).

---

## ADR-001 — Name: Scour

**Status:** Accepted (2026-05-26)

The product is named "Scour." Verb-able ("I scoured it"), short (five letters), brandable, suggests searching exhaustively across many sources.

**Known due-diligence flags (resolve before launch):**
- `scour.com` likely taken (historical: Scour Inc., late-'90s P2P search company)
- App Store / Play Store may already have apps named "Scour"
- Probable available domains: `scour.io`, `scour.shop`, `scour.dev`, `getscour.com`
- Fallback names if blocked: Scoured, Scourly

---

## ADR-002 — No unified checkout

**Status:** Accepted (2026-05-26)

Scour does not act as merchant of record. Every "buy" button deep-links to the retailer's own checkout page.

**Why:** Acting as a payment intermediary requires per-retailer business agreements (Amazon, Walmart, etc. will not give these to a third-party aggregator). Faking unified checkout via card-on-file + bot-checkout is legally fragile and erodes trust the moment it fails.

---

## ADR-003 — Image-based product matching with CLIP

**Status:** Accepted (2026-05-26)

Cross-retailer product matching uses CLIP image embeddings as the primary signal, with text embeddings as fallback and tiebreaker.

**Why:** Listing titles on Temu, Shein, and AliExpress are spammy (`"2024 NEW Premium ★★★★★ Hot Sale"`) and unreliable for matching. Product *images* are typically the same hero shot (often the same supplier photo across resellers). CLIP captures both visual and semantic content in one embedding space.

**How to apply:** When evaluating a candidate listing pair, image-cosine outweighs text-cosine in the weighted score. Threshold tuned per category (electronics tight, fashion loose).

---

## ADR-004 — User-addable sources limited to Shopify storefronts

**Status:** Accepted (2026-05-26)

Users can add sources by pasting a domain — but only Shopify storefronts are supported in v1 (Scour detects via `/products.json`).

**Why:** Allowing arbitrary URL fetching server-side is an SSRF vector. Shopify storefronts have a uniform public endpoint (`/products.json`) that's safe to fetch and returns a known schema. Other platforms have no equivalent.

**Future:** If users want to "add a custom site," they can request a platform adapter; we evaluate per platform.

---

## ADR-005 — Explore page = curated pre-cached queries (not live ingestion)

**Status:** Accepted (2026-05-26)

The Explore / Categories page is backed by a set of pre-defined queries (e.g. "best wireless earbuds under $100", "trending kitchen gadgets") whose results are refreshed on a schedule.

**Why:** A truly live cross-retailer catalog would require continuous ingestion at huge scale. Curated queries deliver the same UX at v1 cost (~dozens of scheduled jobs vs. millions of products).

**Reconsider when:** We have data on which queries users repeat, or a category demands a deeper catalog.

---

## ADR-006 — Local Hugging Face transformers; no external embedding API

**Status:** Accepted (2026-05-26)

Embeddings (text + image) are computed in-process via `@huggingface/transformers` (ONNX runtime). No OpenAI / Cohere embedding API in the hot path.

**Why:** Zero per-call cost, no token budgets, no rate limits, runs anywhere Node runs. Matches FeedHub's stack — author already knows the gotchas.

**Reconsider when:** An embedding-quality bump that only frontier models provide is needed, *and* there is revenue covering API spend.

---

## ADR-007 — Stack baseline: Next.js 16, Prisma 7, better-sqlite3, TypeScript

**Status:** Accepted (2026-05-26)

Same stack as FeedHub.

**Why:** Author has muscle memory; reuses patterns (Source/Item/Story → Retailer/Listing/Product). Reduces design surface so we can spend the novelty budget on the actual hard parts (adapters, matching).

**Reconsider when:** A specific need would dramatically benefit from a different choice (e.g., real-time websocket pipelines, GPU-bound model serving). Default: stay on stack.

---

## ADR-008 — Progressive rendering on search; never block on the slowest adapter

**Status:** Accepted (2026-05-26)

The search results UI streams listings as each adapter returns. A slow or failing adapter does not delay results from faster ones.

**Why:** Fan-out latency is dominated by the slowest source (Temu's anti-bot delays can push 5+ seconds). Blocking on the slowest is unusable UX. React 19 Server Components + streaming is a natural fit.

**How to apply:** Each adapter has a per-query timeout (e.g., 4s). On timeout, mark "Temu still loading…" in the UI; if it returns late, append. Circuit breakers degrade gracefully on repeated failures.
