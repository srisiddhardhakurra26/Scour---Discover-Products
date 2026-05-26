# Architecture

## Data model

Mirrors FeedHub's `Source → Item → Story` pattern, adapted for products.

```prisma
model Retailer {
  // Configured platform: Amazon, AliExpress, Temu, Shein, a Shopify storefront, eBay, ...
  id            String    @id @default(cuid())
  type          String    // "amazon" | "aliexpress" | "shopify" | "rss" (Slickdeals) | ...
  identifier    String    // platform-specific (e.g., domain for Shopify, "amazon-us" for region)
  label         String?
  config        String?   // JSON blob: region, currency, auth, rate-limit budget, etc.
  enabled       Boolean   @default(true)
  lastFetchedAt DateTime?
  lastError     String?
  listings      Listing[]

  @@unique([type, identifier])
}

model Listing {
  // A SKU on a specific retailer. Many listings can map to one Product.
  id              String   @id @default(cuid())
  retailerId      String
  externalId      String   // retailer's own ID
  title           String
  url             String   // deep link to product page
  imageUrl        String?
  priceMinor      Int      // store as cents/paise to avoid float math
  currency        String   // ISO 4217
  shippingMinor   Int?
  availability    String?  // "in_stock" | "low" | "out" | null
  sellerName      String?
  sellerRating    Float?
  reviewCount     Int?
  reviewAvg       Float?
  raw             String?  // original payload for debugging
  textEmbedding   Bytes?
  imageEmbedding  Bytes?
  productId       String?
  capturedAt      DateTime @default(now())
  retailer        Retailer @relation(fields: [retailerId], references: [id], onDelete: Cascade)
  product         Product? @relation(fields: [productId], references: [id], onDelete: SetNull)
  prices          PriceObservation[]

  @@unique([retailerId, externalId])
  @@index([productId])
  @@index([capturedAt])
}

model Product {
  // Cluster of listings representing the same item across retailers.
  id             String   @id @default(cuid())
  canonicalTitle String
  canonicalImage String?
  category       String?
  brand          String?
  firstSeenAt    DateTime
  lastSeenAt     DateTime
  listingCount   Int      @default(0)
  retailerCount  Int      @default(0)
  listings       Listing[]

  @@index([category])
  @@index([lastSeenAt])
}

model PriceObservation {
  // Time series for price history. One row per scrape per listing.
  id          String   @id @default(cuid())
  listingId   String
  priceMinor  Int
  currency    String
  capturedAt  DateTime @default(now())
  listing     Listing  @relation(fields: [listingId], references: [id], onDelete: Cascade)

  @@index([listingId, capturedAt])
}

model SavedProduct {
  // Wishlist + alert config.
  id              String   @id @default(cuid())
  productId       String
  alertBelowMinor Int?
  notes           String?
  createdAt       DateTime @default(now())
}
```

## Search-time fan-out

```
user query
   │
   ▼
QueryDispatcher ── parallel ──► [AmazonAdapter, AliExpressAdapter, TemuAdapter, ...]
   │                                   │
   │                                   ▼
   │                              normalize → Listing
   │                                   │
   │                                   ▼
   │                              embed (text + image, async)
   │                                   │
   │                                   ▼
   ▼                              ProductMatcher
StreamingResults ◄────────────── (nearest-neighbor by embedding;
   (Server-Sent Events             attach to existing Product or create new)
    or React 19 streaming
    Server Components)
```

Key points:

- **Adapters share an isomorphic interface.** Each implements `search(query) → AsyncIterable<NormalizedListing>`. The dispatcher streams listings to the client as they arrive.
- **Embedding is async, off the critical path for first paint.** Show listings immediately; cluster them into Products as embeddings arrive (~hundreds of ms with local HF transformers).
- **Matcher uses cosine similarity** over CLIP image embeddings (primary signal — titles are spammy on Temu / AliExpress) with text-embedding tiebreaker. Threshold tuned per category.

## Product matching — the actual hard part

Approach in priority order:

1. **Exact-match signals first** (cheap): UPC / EAN / ASIN / MPN if exposed in the listing payload.
2. **Image embedding cosine similarity** (CLIP `ViT-B/32` or similar, ONNX via `@huggingface/transformers` runs in Node).
3. **Text embedding fallback** for items without usable images.
4. **Brand + category gating** to keep "two unrelated red dresses" from clustering.

Stored vectors → `embedding Bytes?` is fine for storage but un-queryable. For similarity search at any scale: **sqlite-vec** extension (zero-ops, drop-in) or move to pgvector + Postgres if we outgrow SQLite.

## Adapter strategy

| Platform        | Approach                                                       | Risk                                |
|-----------------|----------------------------------------------------------------|-------------------------------------|
| Amazon          | Product Advertising API (PA-API 5.0, affiliate)                | strict throttle, US-only initially  |
| AliExpress      | Affiliate / Open Platform API                                  | needs approval                      |
| eBay            | Public Finding / Browse API                                    | clean                               |
| Walmart         | Affiliate API                                                  | clean                               |
| Shopify (any)   | `/products.json` public endpoint                               | clean, scales                       |
| Temu            | No API → server-side fetch via proxy + headless fallback       | brittle, plan for breakage          |
| Shein           | No API → same approach as Temu                                 | brittle                             |
| Slickdeals      | RSS                                                            | clean                               |
| Etsy            | Open API                                                       | clean                               |
| Best Buy        | Open API                                                       | clean                               |

Brittle adapters live behind a circuit breaker — if Temu starts 403'ing, the search still returns from the other adapters and the UI shows "Temu unavailable" rather than failing the whole query.

## Caching layers

- **Per-query cache** (Redis later; in-memory + SQLite for v1): same query within N minutes → cached fan-out result.
- **Listing TTLs** vary by source: Amazon ~1h, Slickdeals ~15min, Shopify ~6h.
- **PriceObservation** never expires — that's the price history.

## Why this stack

Same as FeedHub — Next.js 16 (App Router, Server Components for streaming), Prisma 7 + better-sqlite3 for zero-ops local dev, `@huggingface/transformers` for in-process embeddings (no external API spend). Author has muscle memory; we should not introduce a new stack for this. See ADR-007.
