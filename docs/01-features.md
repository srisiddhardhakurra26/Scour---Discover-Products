# Features

Feature list by tier. Higher tier = build later. Within a tier, listed roughly by priority.

## Core (v1 must-ship)

- **Search fan-out.** User types a query → parallel calls to all enabled platform adapters → results stream into the UI as each adapter returns (progressive rendering; never block on the slowest).
- **Product clustering.** Listings that represent the same product across retailers collapse into one card with retailer prices side by side. Text + image embeddings drive the match.
- **Toggleable platform adapters.** Pre-built adapters for Amazon, AliExpress, Temu, Shein, eBay, Walmart, Etsy, Best Buy. User enables/disables per query or globally.
- **Custom Shopify storefronts.** User pastes `coolstore.com` → Scour fetches `coolstore.com/products.json` → catalog added as a source. Limited to Shopify because the endpoint is uniform and safe.
- **Category browsing.** Pre-defined categories (Tech, Beauty, Kitchen, Fashion, Home, etc.). Each is a curated set of pre-cached search queries (cheap to run, same UX as live ingestion at v1 cost).
- **Slickdeals integration.** Slickdeals exposes RSS — drop in as an RSS-typed source. Surface current deals on the Explore page.

## Tier 1 — extends core, high leverage

- **Price history graphs.** Once a listing has been seen more than once, render its price over time (CamelCamelCamel-style).
- **Price-drop alerts.** Email/push when a saved product drops below a user-defined threshold.
- **Image search.** User uploads a photo or pastes an image URL → CLIP embeddings find visually similar products across all enabled retailers. *Marquee differentiator — competitors can't easily copy this.*
- **Browser extension.** One-click "add to Scour" from any product page on a supported retailer. Overlay on retailer pages showing "same product on N other stores, cheapest is $X." Distribution loop.
- **Saved / wishlist.** Per-user `isSaved` flag, foundation for alerts and sharing.

## Tier 2 — strong differentiators

- **Dupes finder.** Visual similarity, not exact match. "I love this $400 Zara coat, find me visually similar items under $80." Shein / Temu / AliExpress's whole vibe.
- **Reviews aggregation.** Pull star ratings from each retailer per product, show a weighted consolidated score (Amazon reviews carry different trust weight than AliExpress).
- **True total cost.** Price + shipping + tariffs/import fees + currency conversion. Especially important for Temu / AliExpress where the listed price hides the real cost.
- **Coupon / promo code finder.** RetailMeNot / Honey angle. Auto-test codes at checkout via the extension.
- **Seller trust score.** For marketplaces (Amazon 3P, AliExpress, eBay) — flag when a cheaper listing has a low-trust seller.

## Tier 3 — niche, later

- Collaborative wishlists (registries, family lists)
- Stock / back-in-stock alerts
- Group-buy / bulk-split (Alibaba angle)
- Sustainability info (origin, materials, carbon)
- Transparent affiliate-link monetization

## Explicitly out of scope

- **Unified checkout.** See [00-vision.md](00-vision.md) and [03-decisions.md](03-decisions.md) ADR-002.
- **Arbitrary-URL user scraping.** SSRF risk; user-addable sources restricted to whitelisted patterns. See ADR-004.
- **Replacing retailer product pages.** We deep-link out; we are a discovery layer.
