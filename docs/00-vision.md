# Vision

## One-liner

Scour aggregates product search across major shopping platforms — Amazon, AliExpress, Temu, Shein, eBay, Walmart, Etsy, indie Shopify stores — and shows results side by side so users compare price, seller trust, and shipping in one view.

## The problem

There is no consumer-facing app that searches across Amazon **and** Temu **and** Shein **and** AliExpress **and** indie Shopify stores in one query. Google Shopping ignores most of these. The platforms themselves intentionally block deep third-party integrations. Existing solutions are either:

- single-platform (Honey, Karma — wishlist on individual stores)
- Shopify-only (Shop app — independent Shopify merchants, no marketplaces)
- B2B / dropshipping (DSers, Dropshipman — sellers, not buyers)
- regional price comparators (PriceRunner, Idealo — limited platform set)

Scour fills the gap for end-users.

## Who it's for

- **Deal hunters** comparing identical products across retailers for the lowest total cost (including shipping/tariffs).
- **Style / dupe shoppers** who saw something on one platform and want to find it cheaper or in a similar form on another (huge for fashion, beauty, home decor).
- **Casual browsers** who want a unified discovery feed instead of opening five tabs.

## Why this exists (and why nobody has done it cleanly)

The hard parts: (1) no public APIs from most platforms, (2) aggressive anti-bot defenses, (3) "same product across stores" matching is genuinely difficult. Most prior attempts have stopped at "tabbed browser wrapper" because the matching problem is hard.

Scour's bet: the matching problem is now solvable with CLIP embeddings (image + text), and adapter maintenance is tractable for a focused set of platforms.

## Non-goals

- **Unified checkout.** Scour deep-links to retailer checkouts. We do not collect payment or act as merchant of record.
- **Universal scraping infrastructure.** Scour ships a curated set of platform adapters; users can't paste arbitrary URLs.
- **Replacing the retailers.** Scour is a discovery layer — listings, prices, reviews — not a marketplace itself.
- **Real-time everything.** Some data (price history, deals) is cached/batched; "live" applies to search results, not a continuous global feed.
