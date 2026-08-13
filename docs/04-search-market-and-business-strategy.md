# Scour search, market, and business strategy

**Research date:** August 13, 2026  
**Status:** Strategic recommendation and validation plan, not a product-market-fit claim  
**Scope:** Search-result quality, source diversity, consumer psychology, market positioning,
business models, unit economics, customer-visible metrics, internal metrics, risks, and
experiments.

This document consolidates the product audit and external research conducted while evaluating
why Scour's results are dominated by Amazon and eBay, what a polished result should contain,
whether that experience can be built at zero licensing cost, and where Scour can credibly
position itself as a business.

It deliberately separates four kinds of evidence:

- **Local observation:** directly visible in the repository or development database.
- **Published evidence:** findings from peer-reviewed research, official documentation, or
  audited/public-company disclosures.
- **Inference:** a conclusion drawn by applying that evidence to Scour.
- **Hypothesis:** something that must be tested with Scour users and real payment behavior.

No paper, case study, or comparable company can prove product-market fit for Scour. Only
observed acquisition cost, usage, payment, retention, and post-purchase outcomes can do that.

---

## Executive conclusion

Scour should remain consumer-facing for now, but it should not position itself as merely
"search every store." That is a commodity promise against Google, Amazon, large marketplaces,
and general-purpose AI agents with vastly greater distribution and catalog access.

The strongest position to test is:

> **Scour is an independent decision engine for purchases that are expensive, complicated, or
> easy to regret. It turns scattered offers, expert evidence, owner experience, price history,
> safety information, and long-term costs into a small, defensible shortlist.**

A shorter customer promise worth testing is:

> **Make a purchase you can defend.**

That promise describes the job better than "one search, every store": reduce the consumer's
search labor, uncertainty, downside risk, and anticipated regret while leaving the consumer in
control of the decision.

The recommended business sequence is:

1. Keep the core consumer decision experience free.
2. Use affiliate referrals to finance the free layer, but enforce a hard separation between
   commission and organic ranking.
3. Focus on high-consideration durable purchases and multi-item life-event missions rather than
   cheap commodities.
4. Test one-off paid research before assuming consumers want another monthly subscription.
5. Build recurring premium value around ownership: price, warranty, recall, maintenance, parts,
   repair, and resale tracking.
6. Do not pivot to retailer search SaaS yet. That is a different, crowded enterprise product.
7. Consider an aligned B2B2C distribution model later, after Scour can demonstrate improved
   consumer outcomes.
8. Reject sponsored organic rankings. Neutrality is part of the product, not a disclosure in a
   footer.

The central strategic fact is:

> **Source diversity is not a secondary engineering improvement. It is the basis of the product's
> differentiation, trust, and business model.**

Without genuinely different sources, Scour is another affiliate search interface. With a
trustworthy evidence graph, diverse inventory, calibrated recommendations, and measured
post-purchase outcomes, it can occupy a useful position between marketplace search and expensive
original product testing.

---

## 1. What Scour is today

### 1.1 Current product shape

The repository currently describes a consumer application that:

- Fans a query out across enabled retailer adapters.
- Clusters offers believed to represent the same product.
- Supports normal product searches and multi-category shopping missions.
- Deep-links to retailers rather than providing checkout.
- Stores wishlists and price alerts.
- Includes an AI shopping copilot.
- Provides a browser-extension cheaper-offer lookup.
- Exposes the same capabilities through an MCP endpoint.
- Allows consumers to add, enable, disable, and monitor sources.

See [`README.md`](../README.md) for the implemented feature inventory. Nothing in the current
application resembles a retailer's production search platform: there is no merchant catalog SDK,
tenant isolation, merchandising console, conversion-event integration, experimentation suite,
enterprise SLA, or checkout instrumentation. Scour is therefore a **B2C metasearch and decision
product today**, even though parts of its technology might later support B2B products.

### 1.2 Development-data source snapshot

The following is a dated observation from `prisma/dev.db` on August 13, 2026. It is not a market
coverage claim and will change as the local database changes.

| Enabled source | Adapter type | Persisted listings |
|---|---:|---:|
| Allbirds | Shopify | 250 |
| Amazon | Amazon HTML | 219 |
| blundstone.com | Shopify | 204 |
| eBay | eBay HTML | 181 |
| Death Wish Coffee | Shopify | 142 |
| Slickdeals | RSS | 99 |
| Four Reddit communities | Reddit | 0 |
| Etsy | Etsy API | 0 |
| Best Buy | Best Buy API | 0 |
| **Total** |  | **1,095** |

The same database contained 1,093 product rows for 1,095 listings. Persisted clustering had
therefore merged almost nothing at that snapshot. That does not by itself prove that the
clustering algorithm is defective: the inventory has little overlapping coverage, and the
database may not reflect a complete reclustering pass. It does prove that the current user cannot
yet receive the intended "same product, multiple merchants" experience at meaningful scale.

Inventory breadth is also narrow. The direct-store listings are concentrated in shoes and
coffee, while the broad sources are Amazon, eBay, and deals. A ranking cap can limit visible
dominance, but it cannot create missing evidence or missing merchants.

### 1.3 Adapter fragility and evidence limitations

Local code inspection shows:

- Amazon uses public search-page HTML and explicitly detects bot challenges. See
  `src/lib/adapters/amazon.ts`.
- eBay also uses search-page HTML and must first obtain and cache homepage cookies. See
  `src/lib/adapters/ebay.ts`.
- Reddit uses OAuth when credentials exist and otherwise tries public JSON, which can return
  HTTP 403. The adapter uses the post title and self-text to extract a possible price, but the
  returned evidence is essentially the title plus score/comment-count metadata; it does not
  retrieve or synthesize the comment discussion. See
  `src/lib/adapters/reddit.ts`.
- Etsy and Best Buy require keys/approval and currently contributed no persisted listings in the
  audited database.
- Shopify feeds provide useful direct inventory, but only from the few stores explicitly added.

The current ranking layer defaults to approximately 40% of the result set per source. This is a
useful guardrail, but Amazon and eBay can still jointly occupy about 80% of a result page. More
importantly, source caps only diversify domains. They do not guarantee diversity of evidence,
product type, merchant authority, price, or perspective.

### 1.4 Diagnosis

The main problem is not simply that Scour has too few URLs. It lacks **source-role diversity**.

Amazon and eBay are transaction sources. They can contribute offers, seller information, prices,
and reviews, but they should not be expected to supply all of the following:

- Manufacturer truth and exact model identity.
- Independent performance testing.
- Owner experience over months or years.
- Community discussion of edge cases and failure modes.
- Safety and recall information.
- Repairability, parts, warranty, and longevity.
- Reliable price history and total landed cost.

A polished experience needs both **inventory coverage** and **decision evidence**. Adding more
marketplaces without adding new evidence classes would make the page look more diverse without
making the decision meaningfully better.

---

## 2. What a polished search result should be

A result should not be modeled as a flat listing. It should be modeled as a product entity with
multiple offers and multiple evidence claims.

### 2.1 Product-level structure

```text
Product entity
├── identity
│   ├── brand, model, GTIN/UPC/EAN/MPN/SKU
│   ├── variants and compatibility
│   └── manufacturer specification claims
├── offers
│   ├── direct/authorized retailers
│   ├── marketplaces
│   ├── used/refurbished/resale
│   ├── price, shipping, tax estimate, returns, availability
│   └── freshness and affiliate disclosure
├── evidence
│   ├── independent expert tests
│   ├── verified-owner reviews
│   ├── community discussions
│   ├── safety/recall records
│   ├── warranty, repair, parts, and longevity
│   └── price history
└── decision layer
    ├── user requirements met and violated
    ├── material trade-offs
    ├── source agreement/disagreement
    ├── missing evidence
    └── calibrated recommendation or shortlist
```

This separation matters. Ten offers for the same product do not equal ten independent pieces of
evidence. Five pages repeating a manufacturer's specification do not equal corroboration.

### 2.2 Required source classes

#### A. Direct and authorized commerce

Use manufacturer stores, authorized retailers, direct merchant feeds, Shopify/WooCommerce feeds,
and official retailer APIs where possible.

These sources improve:

- New-product availability.
- Warranty legitimacy.
- Variant and model clarity.
- Seller authority.
- Alternatives beyond the largest marketplaces.

Direct merchant feeds should be the preferred long-term path because they are more stable than
scraping and can include structured inventory, variants, shipping, and availability.

#### B. Large marketplaces

Amazon, eBay, Etsy, Walmart, and similar marketplaces remain important for breadth, price
competition, used inventory, and long-tail availability. They should be treated as commerce
sources, not as the entire decision record.

Official integration examples include:

- [eBay Browse API](https://developer.ebay.com/develop/api/buy/browse_api), which supports
  keyword, category, GTIN, product, compatibility, and image search.
- [Best Buy Products API](https://developers.bestbuy.com/apis), which exposes current and
  historical products, specifications, pricing, availability, descriptions, and images.
- [Etsy Open API v3](https://developers.etsy.com/documentation/), which requires app registration
  and review, with separate commercial-access rules.

The official eBay API should replace the current cookie-dependent HTML adapter when credentials
and program approval allow it. Amazon should also move away from public HTML to an approved
affiliate/product-data integration. Current Amazon Product Advertising Content rules include
strict caching, display, refresh, and attribution requirements; public HTML scraping is not a
stable production foundation. See the current [Amazon Associates policies](https://affiliate-program.amazon.com/help/operating/policies).

#### C. Resale, refurbished, and local availability

For durable goods, price diversity is incomplete without used, manufacturer-refurbished,
certified-refurbished, open-box, and local options. These offers can materially change total value
and sustainability, but condition must never be mixed silently with new inventory.

Required fields include:

- Condition and grading standard.
- Warranty source and duration.
- Seller type and reputation.
- Return rights.
- Missing accessories.
- Battery or wear indicators where relevant.

#### D. Deals and price history

Slickdeals and merchant promotions are useful discovery signals, but "deal" should not be
accepted as truth. A polished experience needs an observed price series and an explicit reference
period before claiming savings.

Useful outputs include:

- Current price percentile within the observed history.
- Lowest observed price and date.
- Typical price range.
- Promotion frequency.
- Whether shipping or required accessories erase the nominal discount.

#### E. Manufacturer and standards evidence

Manufacturer pages are the preferred source for dimensions, compatibility, materials,
certifications, warranty terms, manuals, parts, and model identifiers. Manufacturer claims should
be labeled as first-party claims, not independent evidence.

Structured product markup is a scalable extraction layer. Schema.org supports `Product`, `Offer`,
and [`AggregateOffer`](https://schema.org/AggregateOffer), including the common case of one product
with multiple merchant offers.

#### F. Independent expert testing

Independent testing provides evidence marketplaces normally cannot: measured performance,
controlled comparisons, safety, reliability, and failure modes.

Potential partners or licensed sources vary by category and jurisdiction. Examples include
Consumer Reports, Wirecutter, RTINGS, Which?, Stiftung Warentest, specialist publications, and
laboratory/certification organizations. Their content cannot be copied merely because it is
visible on the web; licensing, quotation, and linking rights must be respected.

Consumer Reports illustrates the cost of true evidence production: it buys the products it tests,
maintains specialist staff and laboratories, accepts no advertising, and expected to spend more
than $30 million on testing and reviewing products and services. See its
[testing methodology](https://www.consumerreports.org/about-us/what-we-do/research-testing/).

Scour should not imply that aggregated commentary is equivalent to original testing.

#### G. Owner reviews

Owner reviews can reveal long-term reliability, fit, support quality, and uncommon defects, but
raw star averages are unsafe as a recommendation signal.

The evidence layer should distinguish:

- Verified purchase or verified ownership where available.
- Review age and ownership duration.
- Incentivized or promotional reviews.
- Rating distribution, especially one-star failure modes.
- Sudden review bursts and repeated language.
- Model/variant mismatch.
- Review coverage across independent platforms.

Research on fake Amazon reviews found that purchased reviews temporarily increased ratings and
sales, while the products' ratings later declined and one-star shares rose, especially for young,
low-quality products. See [The Market for Fake Reviews](https://pubsonline.informs.org/doi/10.1287/mksc.2022.1353).

The FTC's consumer-review rule has applied since October 21, 2024 and addresses fake, false, and
deceptive reviews and testimonials. It also prohibits misrepresenting a controlled review site as
independent. See the [FTC rule Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers).

#### H. Communities and specialist forums

Communities are useful for questions that formal reviews often miss:

- Recurring failure modes.
- Compatibility traps.
- Repair experience.
- Long-term ownership.
- Category-specific alternatives.
- Whether a recommendation changes by climate, body type, workflow, or skill level.

Scour should not rank a Reddit post as if it were a product offer. Community content should be a
separate evidence panel attached to product entities and claims. A useful community extractor
needs more than titles and upvote counts; it needs representative comment threads, timestamps,
conflict, ownership assertions, and links back to context.

Reddit cannot be assumed to be a free commercial data supply. Its July 2026
[Data API Terms](https://redditinc.com/policies/data-api-terms) require a separate agreement for
commercial use or use beyond expressly permitted limits. Any production design must obtain the
appropriate rights and minimize storage of personal data.

Category-specific forums, repair communities, enthusiast publications, and public discussion
boards may provide better evidence than generic social media, but each has its own terms and
community norms.

#### I. Safety, recalls, and regulatory evidence

Safety is a differentiated and consumer-aligned evidence class. The U.S. Consumer Product Safety
Commission provides machine-readable recall data in JSON and XML through its
[public Recalls API](https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information).

Depending on category and market, Scour may also need:

- NHTSA vehicle and child-seat recalls.
- FDA safety notices for regulated products.
- Energy Star and energy-label data.
- UL, ETL, FCC, CE, and other certification records where legally usable.
- Regional consumer-safety agencies outside the United States.

Safety evidence must be matched conservatively by model/identifier. A brand-name match is not
enough to declare a product recalled.

#### J. Repairability, parts, warranty, and longevity

For durable products, the cheapest offer can be the most expensive ownership decision. Useful
signals include:

- Warranty duration and exclusions.
- Parts availability and price.
- Repair manuals and diagnostic support.
- Battery replacement.
- Software-support horizon.
- Expected energy or consumable cost.
- Reliability evidence and known failure modes.
- Resale value.

This evidence is strategically important because it extends Scour from a purchase event into an
ownership relationship, creating a stronger recurring consumer product.

### 2.3 Product identity and evidence provenance

Scour needs a product graph, not only text similarity.

Preferred identity signals, roughly from strongest to weakest, are:

1. Exact GTIN, UPC, EAN, ISBN, ASIN-to-GTIN mapping, manufacturer part number, or stable model ID.
2. Exact manufacturer + model + variant combination.
3. Exact canonical image or strong perceptual-image match with compatible model evidence.
4. High-confidence structured attribute match.
5. Conservative text/embedding similarity.
6. LLM judgment only for ambiguous pairs, never as the sole source of identity truth.

Every extracted fact should retain:

- Source URL and source class.
- Publisher/merchant identity.
- Extraction time and last verification time.
- Whether the fact is claimed, measured, observed, or inferred.
- Product and variant identity confidence.
- Licensing/display restrictions.
- Contradictory claims from other sources.

The [Web Data Commons product-matching corpus](https://www.webdatacommons.org/largescaleproductcorpus/)
and its [product extraction corpus](https://www.webdatacommons.org/productcorpus/) are useful free
research and evaluation resources. They are not substitutes for live, licensed commercial offer
feeds.

---

## 3. Search and recommendation design

### 3.1 Retrieval and ranking pipeline

A polished pipeline should separate these stages:

1. Parse the decision request into product type, hard constraints, preferences, budget,
   compatibility, condition, and decision context.
2. Retrieve from multiple independent commerce and evidence channels.
3. Normalize prices, conditions, units, identifiers, and variants.
4. Reject unsafe, irrelevant, incompatible, or unsupported matches.
5. Resolve product identity conservatively.
6. Cluster offers by product entity.
7. Score product fit independently from merchant monetization.
8. Select a diverse shortlist across meaningful dimensions.
9. Attach evidence, disagreements, omissions, and offer freshness.
10. Present an inspectable recommendation with alternatives.

### 3.2 Relevance before diversity

Diversity cannot rescue irrelevant results. Hard constraints such as exact model, compatibility,
maximum price, size, material, condition, or product-versus-accessory distinctions must be applied
before diversification.

The existing frozen search benchmark in [`docs/search-quality.md`](search-quality.md) covers exact
models, attributes, compatibility, budgets, spelling, missions, diversity, and outages. It should
remain the regression gate for ranking changes.

The Amazon ESCI dataset is a useful external reference for product-search relevance labels and
query-product judgments: [ESCI paper and dataset description](https://arxiv.org/abs/2206.06588).

### 3.3 Meaningful diversity

Result diversity should cover dimensions that improve the decision:

- Product model and brand.
- Price/value tier.
- Merchant/source class.
- New, used, refurbished, and open-box condition.
- Direct/authorized versus marketplace seller.
- Material feature or trade-off.
- Evidence coverage.
- Popular versus less-exposed but highly relevant alternatives.

Domain diversity alone is inadequate. Two marketplace resellers showing the same item are not
meaningfully diverse.

The xQuAD framework is a foundational example of explicit search-result diversification:
[xQuAD paper](https://eprints.gla.ac.uk/44352/). Recommendation research also documents popularity
and exposure bias; examples include [popularity-bias evaluation](https://arxiv.org/abs/2006.04275)
and [FairMatch](https://research.tue.nl/en/publications/a-graph-based-approach-for-mitigating-multi-sided-exposure-bias-i/).

Scour should use such work as design guidance, not assume that an academic objective transfers
unchanged to shopping. Diversity must be evaluated alongside relevance and decision outcomes.

### 3.4 Community evidence should not contaminate offer ranking

Community posts, expert articles, recalls, and merchant offers have different semantics. They
should be retrieved and evaluated separately, then joined at the product/claim layer.

An appropriate result page could contain:

- A small product shortlist.
- Offers for each product.
- "Why it fits" and "what may disqualify it."
- Expert-test findings.
- Owner/community failure modes.
- Safety and ownership evidence.
- Explicit disagreement and unknowns.

This architecture prevents a highly upvoted discussion or deal post from masquerading as a
buyable product.

### 3.5 Calibrated recommendations, not an oracle

Scour should help the consumer remain the author of the decision:

- Let users modify requirements and preference weights.
- Show which requirements each finalist satisfies or violates.
- Expose material uncertainty and source disagreement.
- Let consumers inspect and remove evidence sources.
- Offer multiple defensible finalists rather than one unexplained winner.
- Avoid a universal opaque "Scour Score."

Research on algorithm reliance is not one-directional. Six experiments found algorithm
appreciation in several judgment tasks, while other work found that people quickly reject
imperfect algorithms after seeing errors. Giving users even slight control increased adoption of
an imperfect algorithm and improved performance. See
[Algorithm Appreciation](https://escholarship.org/uc/item/9v38k9m6) and
[Overcoming Algorithm Aversion](https://pubsonline.informs.org/doi/abs/10.1287/mnsc.2016.2643).

More explanation is not automatically safer. One decision-aid experiment found that more
elaborate explanations increased confidence and reduced decision time while producing inferior
choices. See the [decision-aid overconfidence study](https://www.sciencedirect.com/science/article/pii/S0167923611002478).

Therefore Scour should optimize **calibrated confidence and decision quality**, not confidence,
engagement, or explanation length in isolation.

---

## 4. Can the source strategy be free of cost?

### 4.1 Short answer

A prototype and early validation phase can have **zero or very low licensing cost**. A polished,
reliable, commercially scalable product will not be cost-free.

"No per-request API charge" is not the same as free. Costs also include engineering, compliance,
approval, crawling, proxies, data refresh, hosting, LLM inference, monitoring, support, affiliate
attribution, and the opportunity cost of brittle integrations.

### 4.2 Zero- or low-license-cost inputs

Potential early inputs include:

- Direct merchant feeds voluntarily supplied to Scour.
- Public Shopify/WooCommerce catalogs where terms permit use.
- RSS feeds.
- Approved free developer tiers for retailer APIs.
- Public government recall and safety APIs.
- Public manufacturer pages and structured data, subject to site terms and robots policies.
- Schema.org `Product` and `Offer` markup.
- Web Data Commons research corpora for identity-system development and evaluation.
- User-contributed source URLs.
- Open datasets whose licenses permit the intended commercial use.

### 4.3 Inputs that require approval, a contract, or eventual payment

- Amazon affiliate/product content, including compliance and refresh requirements.
- Etsy commercial access.
- Reddit commercial data access.
- Licensed expert-test and review content.
- Commercial product graphs, GTIN resolution, pricing, and inventory feeds.
- High-volume SERP/data providers or proxy infrastructure.
- Email, push, observability, security, and production hosting.
- Original laboratory testing or contracted experts.

### 4.4 Practical cost strategy

1. Validate demand with approved/free sources and a deliberately narrow category.
2. Obtain direct merchant feeds rather than endlessly repairing scrapers.
3. Measure which missing evidence changes decisions before licensing it.
4. Pay for the source that removes the largest measured decision-quality bottleneck.
5. Never promise "every store" when contractual and technical coverage cannot support it.

---

## 5. Consumer psychology and economic value

### 5.1 The value is conditional, not universal

Choice overload is real under particular conditions, not a law that fewer options always improve
outcomes. A meta-analysis of 99 observations and 7,202 participants identified four important
moderators:

- Choice-set complexity.
- Decision-task difficulty.
- Preference uncertainty.
- The consumer's decision goal, particularly effort minimization.

It also identified satisfaction/confidence, regret, choice deferral, and switching likelihood as
important outcomes. See [Choice overload: A conceptual review and meta-analysis](https://doi.org/10.1016/j.jcps.2014.08.002).

**Inference for Scour:** the most promising users are not everyone who shops. They are people
making complex decisions without a settled preference, especially where a bad choice has a real
cost.

### 5.2 Search time is an economic cost

Consumers spend time locating prices, comparing incomparable variants, resolving seller risk,
and checking claims. A 2025 online experiment found that search-cost estimates, once context
effects were modeled, corresponded well to participants' opportunity cost of time. See
[Search Costs and Context Effects](https://www.aeaweb.org/articles?id=10.1257%2Fmic.20240115).

The wider economics literature also shows that online sellers can deliberately create search
friction through product proliferation, add-ons, and other forms of obfuscation. See
[Search and Obfuscation in a Technologically Changing Retail Environment](https://www.journals.uchicago.edu/doi/full/10.1086/694405)
and [Search, Obfuscation, and Price Elasticities on the Internet](https://economics.mit.edu/sites/default/files/publications/Search%2C%20Obfuscatuibm%20and%20Price%20Elasticities%20on%20the.pdf).

**Inference for Scour:** normalizing model identity, landed cost, condition, and required
accessories is not merely convenient UI. It counters an economically meaningful market friction.

Scour should still measure time saved rather than claim it from theory. The counterfactual varies
by user, category, and expertise.

### 5.3 Consumers seek a justifiable decision, not only the lowest price

Panel research on consumer-electronics purchases found that justifiability, confidence,
anticipated regret, evaluation costs, and final negative affect influence decision and consumption
satisfaction, which in turn affect loyalty, recommendations, and word of mouth. See
[Choice Goal Attainment and Decision and Consumption Satisfaction](https://business.columbia.edu/faculty/research/choice-goal-attainment-and-decision-and-consumption-satisfaction).

**Inference for Scour:** the product should sell a defensible decision, not simply a cheaper link.
It should explain why a finalist fits, what could make it wrong, and what evidence remains absent.

### 5.4 Trust is an incentive-design problem

An experiment comparing a neutral recommendation agent with a disclosed sponsor-biased agent
found lower trust and higher distrust for the biased agent. Combining explanations and sponsorship
disclosure helped trust under some conditions but did not eliminate distrust. See
[Effects of Recommendation Neutrality and Sponsorship Disclosure](https://pubsonline.informs.org/doi/abs/10.1287/mnsc.2017.2906).

**Inference for Scour:** affiliate disclosure is necessary but insufficient. The system must make
it structurally difficult for commission to influence the recommendation.

### 5.5 The philosophical position

Most commerce platforms optimize seller revenue, advertising yield, conversion, or engagement.
Scour's defensible philosophical position is **consumer epistemic agency**:

- Help the user know what is known.
- Distinguish evidence from claims and popularity.
- Make uncertainty legible.
- Preserve the user's ability to disagree with the system.
- Optimize for durable satisfaction rather than an immediate click.

This is not anti-commerce. A better-informed purchase can benefit high-quality merchants and
reduce returns. It does mean Scour cannot simultaneously claim consumer independence and sell
unmarked influence over organic recommendations.

---

## 6. Market position and initial wedge

### 6.1 Recommended category

Scour should define itself as a **consumer decision engine**, not a universal catalog or a generic
AI shopping assistant.

The useful competitive space is between:

- Marketplace search, which is broad but usually optimized within one commercial environment.
- Price comparison, which often compares offers but provides shallow decision evidence.
- Editorial review sites, which provide interpretation but cover a limited set of products and
  may not have live comprehensive offers.
- Original testing organizations, which produce strong evidence but are expensive and slow to
  cover the whole market.
- General AI assistants, which can converse but may lack live, licensed, auditable commerce and
  product identity data.

Scour can combine live offer comparison with an evidence-based, user-controlled decision brief.

### 6.2 Best initial use cases

Prioritize purchases where all of these are true:

- The purchase is expensive enough that a mistake matters.
- There are many similar models or incompatible variants.
- Price and seller terms vary across stores.
- Reliability, safety, warranty, or ownership cost matters.
- The customer does not buy frequently enough to become an expert.

Promising categories include:

- Appliances.
- Consumer electronics and computers.
- Tools and workshop equipment.
- Furniture and home-office equipment.
- Outdoor equipment.
- Baby gear where safety evidence can be handled rigorously.
- Multi-item projects such as moving, furnishing an office, setting up a nursery, starting a
  workshop, or preparing for college.

The exact first category is a hypothesis. It should be selected using source availability,
decision difficulty, affiliate economics, return risk, and access to credible evidence.

### 6.3 Poor initial use cases

- Low-price commodities with low downside risk.
- Categories where Amazon is already sufficiently fast and complete.
- Fashion or beauty recommendations requiring strong subjective/personal fit before Scour can
  elicit it well.
- Medical, financial, or safety-critical recommendations without the necessary expert and
  regulatory governance.
- Exact-model navigational searches as the main business; these are useful but easy to copy and
  rarely support consumer payment.

### 6.4 The customer job

The customer is not buying "AI." The customer is buying:

1. Less search labor.
2. Less downside risk.
3. A shortlist aligned to explicit requirements.
4. A decision that can be explained to oneself or another person.
5. Continued help after purchase.

Customer-facing language should emphasize the outcome:

- "Know why it fits before you buy."
- "Compare the product, the seller, and the evidence."
- "See the trade-offs other shopping results hide."
- "Make a purchase you can defend."

These are hypotheses for testing, not approved final copy.

---

## 7. Business-model assessment

| Model | Economic attraction | Primary problem | Recommendation |
|---|---|---|---|
| Free B2C with affiliate referrals | Low customer friction; revenue follows purchase intent | Thin margins, short attribution, merchant dependence, acquisition cost, trust conflict | Best initial financing model |
| Paid consumer search subscription | Recurring, consumer-aligned revenue | Shopping is episodic; current aggregation may not be sufficiently exclusive | Do not lead with it yet |
| One-off premium decision brief | Matches an episodic, consequential purchase | Must be visibly and measurably better than free search | Test after source quality improves |
| Ownership membership | Recurring post-purchase value | Requires longitudinal product, warranty, recall, maintenance, and parts data | Strong long-term premium hypothesis |
| Retailer search SaaS | Clear conversion and labor ROI; larger contracts | Different product, crowded market, enterprise requirements | Do not pivot now |
| B2B product-data/search API | Reusable technical asset | Data redistribution rights and SLAs; affiliate feeds may prohibit resale | Only with licensed data and a specific buyer |
| B2B2C embedded consumer benefit | Institution can fund distribution while consumer remains beneficiary | Long sales cycles and channel dependency | Plausible later channel |
| Sponsored organic ranking | Near-term monetization | Destroys the independence proposition | Reject |

### 7.1 Recommended initial model: free consumer layer plus affiliate referrals

Core search and comparison should be free while the company learns which decisions recur and
which evidence changes outcomes.

Affiliate monetization requires a ranking firewall:

- Relevance and decision fit are computed without commission rate.
- Organic product rank cannot be bought.
- Merchant bids cannot determine product prominence.
- Any paid placement is separate, visually labeled, and excluded from evidence/confidence scores.
- Scour publishes its ranking and monetization principles.
- An automated audit checks correlation between commission and rank.
- Offers without an affiliate relationship remain eligible.

Affiliate revenue should be treated as **financing**, not as the definition of customer value.

### 7.2 Affiliate unit economics

At the session level:

```text
gross affiliate revenue per research session
  = attributable purchase probability
  × eligible order value
  × realized commission rate
```

At the acquired-user level:

```text
contribution LTV
  = lifetime research sessions
  × (affiliate revenue/session + premium revenue/session)
  - variable data, inference, support, and notification costs

maximum sustainable CAC < contribution LTV
```

Amazon's current standard commission rates for many relevant categories are roughly 1% to 4.5%,
with some higher and zero-rate exceptions. A standard session generally ends after 24 hours, an
order, or another associate's link; returns and refunds are excluded. See the
[Amazon rate card](https://affiliate-program.amazon.com/help/node/topic/GRXPHT8U84RAYDXZ) and
[Associates policies](https://affiliate-program.amazon.com/help/operating/policies).

eBay also generally requires purchase, bid, or best-offer activity within a 24-hour window. See
the [eBay Partner Network rate card](https://partnernetwork.ebay.com/our-program/rate-card).

Illustrative sensitivity at a 5% attributable purchase probability—not a Scour forecast:

| Eligible order value | Realized commission | Gross revenue/research session |
|---:|---:|---:|
| $75 | 3% | $0.11 |
| $400 | 3% | $0.60 |
| $1,000 | 3% | $1.50 |

These amounts precede infrastructure, data, inference, refunds, support, and acquisition costs.
This is why low-value commodity search is economically weak and why Scour needs high-intent
episodes, higher-value categories, inexpensive distribution, and repeat use.

Every category should have its own model using actual:

- Outbound click rate.
- Attributed order rate.
- Average eligible order value.
- Realized commission after returns and exclusions.
- Attribution loss.
- Variable search/inference cost.
- Acquisition cost by channel.
- Repeat-session rate.

### 7.3 Direct consumer payment

Consumers demonstrably pay for high-quality decision support, but comparable evidence must be
interpreted carefully.

Consumer Reports reported:

- Five million members in FY2025.
- More than 2,300 products/services tested in over 100 categories that year.
- More than 10,000 ratings and reviews available to members.
- A current digital annual membership price of $39.
- Approximately $208.3 million in subscriptions, newsstand, and other sales in FY2025.

Sources: [Consumer Reports 2025 impact report](https://www.consumerreports.org/annual-report/2025/impact/),
[membership pricing](https://www.consumerreports.org/membership), and
[audited financial summary](https://www.consumerreports.org/annual-report/2025/financials/).

However, Consumer Reports conducts original testing, surveys, advocacy, and investigative work,
buys products, accepts no advertising, and has accumulated trust over decades. Its success does
not prove that consumers will pay for Scour's current aggregation layer.

The more credible paid Scour products are:

- A one-time deep-research dossier for an expensive purchase or project.
- Human-assisted or expert-reviewed research for especially consequential purchases.
- A household product record with warranty, recall, maintenance, parts, and resale support.
- Licensed premium evidence unavailable in the free layer.
- A member-funded, no-affiliate mode if sufficient demand exists.

Because shopping episodes are irregular, test a one-time purchase before building the financial
plan around monthly subscriptions. An annual membership becomes more plausible once Scour
provides recurring ownership value.

### 7.4 Comparable free/referral businesses

#### Wirecutter

Wirecutter proves that high-quality free recommendations can generate affiliate revenue. But it
sits inside The New York Times' distribution, brand, content, and subscription bundle. The Times'
2025 filing reports that Wirecutter referral revenue grew by $5.1 million but does not disclose
Wirecutter as a standalone profit-and-loss business. See the
[New York Times 2025 10-K](https://www.sec.gov/Archives/edgar/data/71691/000007169126000011/nyt-20251231.htm).

Lesson: editorial trust plus distribution can support affiliate commerce; this does not show that
a new generic aggregator can acquire users profitably.

#### NerdWallet

NerdWallet's 2025 filing describes a free consumer platform combining independent editorial,
comparison tools, product marketplaces, and referrals. It generated $836.6 million of revenue but
spent $584.7 million on sales and marketing, including $416.9 million on performance marketing.
It also reported pressure on organic search as users moved toward AI overviews and LLMs. See the
[NerdWallet 2025 10-K](https://www.sec.gov/Archives/edgar/data/1625278/000162527826000014/nrds-20251231.htm).

Lesson: referral economics can scale in high-value categories, but distribution can absorb an
enormous share of revenue. Scour must measure paid and organic CAC separately and avoid assuming
SEO will remain a durable moat.

#### trivago

trivago is a close metasearch analog: consumers compare offers and complete the transaction on an
advertiser's site. In 2025 it reported €532.9 million of referral revenue, but global advertising
ROAS was 128.4% before other operating costs. Expedia-affiliated brands and Booking Holdings
brands together represented 74% of referral revenue. Its auction bids also influence offer
placement. See the [trivago 2025 filing](https://www.sec.gov/Archives/edgar/data/1683825/000168382526000006/trvg-20251231.htm).

Lesson: metasearch is viable at scale but can be acquisition-intensive, advertiser-concentrated,
and structurally biased toward monetized prominence. Scour should not copy the auction-ranked
marketplace if independence is its differentiator.

### 7.5 Why not pivot to retailer search SaaS now

Retailer search buyers have a legible ROI model:

- Search conversion.
- Revenue per search session.
- Zero-result and low-result rates.
- Add-to-cart rate.
- Time to first relevant result.
- Merchandising labor.
- Latency, availability, and freshness.

Vendor-published case studies demonstrate what buyers value. Algolia reports, for example, a 19%
search-related conversion uplift for KIKO and a 41% conversion increase from search for
Al-Futtaim. These are useful demand signals but should not be treated as independent proof or as
expected Scour results; they are vendor case studies and may use before/after rather than
randomized comparisons. See the [KIKO case](https://www.algolia.com/customers/kiko) and
[Al-Futtaim case](https://www.algolia.com/customers/al-futtaim-group).

Baymard's 2026 benchmark says 56% of assessed ecommerce sites inadequately support users' search
needs, confirming that the problem remains. See the
[Baymard ecommerce-search benchmark](https://baymard.com/blog/ecommerce-search-query-types).

But Scour currently lacks:

- Merchant catalog ingestion and real-time change pipelines.
- Tenant isolation, permissions, billing, and SLAs.
- Merchandising and business-rule tools.
- Conversion-event and checkout integration.
- A/B experimentation and causal lift reporting.
- Regional catalogs, languages, currencies, and inventories.
- Contractual support and security governance.
- Rights to redistribute all aggregated source data.

This would be a different company competing with Algolia, Constructor, Bloomreach, and commerce
platform incumbents. Do not undertake that pivot merely because B2B metrics are easier to name.

### 7.6 More aligned later B2B options

Potential later products, only after consumer outcome evidence exists:

- **B2B2C research benefit:** a publisher, credit union, membership group, employer, or benefits
  platform pays to give consumers independent decision support.
- **Search-quality diagnostic:** evaluate a merchant's retrieval, relevance, product data, and
  query gaps without replacing its search platform.
- **Aggregate market insight:** privacy-preserving demand gaps, attribute confusion, and product
  comparison trends. This must not change consumer rankings.
- **Licensed product/evidence graph API:** only where Scour possesses clear redistribution rights,
  match-quality evidence, and production SLAs.

The organizational firewall should be explicit: a commercial customer may not pay to influence
consumer recommendations.

---

## 8. Metrics

### 8.1 Customer-visible metrics

Customer metrics must answer **"Why should I trust this decision?"**, not "How large is Scour's
database?"

Show when supported:

- User requirements satisfied and violated for every finalist.
- Unique product models after deduplication.
- Unique merchants and source classes.
- Source composition: first-party, retailer, marketplace, resale, expert, verified owner,
  community, and regulatory.
- Offer freshness and last verification time.
- Landed price, including known shipping and required accessories.
- New/used/refurbished/open-box condition.
- Authorized versus marketplace seller status.
- Price history, typical range, and current percentile.
- Warranty, return, repair, parts, support-horizon, and recall evidence.
- Cross-source agreement and disagreement.
- Missing evidence and why confidence is limited.
- Material alternatives and the trade-off each makes.
- Long-term ownership cost where the inputs are credible.

Do not show:

- "Listings tracked" as a headline value metric.
- "Sources enabled" without explaining their roles and successful coverage.
- An unexplained AI confidence percentage.
- Savings against an invented, stale, or selectively chosen reference price.
- Raw average star ratings without review-quality context.
- "Hours saved" without a measured and defensible counterfactual.
- Diversity padded by duplicate listings or near-identical merchants.
- An overall score whose weights and missing data are invisible.

### 8.2 Consumer-product north star

The eventual north-star outcome should be:

> **The percentage of high-consideration research episodes that produce a shortlist or purchase
> the customer remains satisfied with after 30 to 90 days.**

Follow-up questions should include:

- Did the customer purchase?
- Did they keep, cancel, or return it?
- Does it satisfy the requirements they said mattered?
- Would they choose it again?
- How much regret remains?
- Did they restart the same search elsewhere?
- Did a missing or incorrect fact cause harm?

This is slower than optimizing clicks, but it measures the claimed product value.

### 8.3 Leading search and decision-quality metrics

- Successful-shortlist rate.
- Time to first genuinely relevant product.
- Time to a defensible shortlist.
- Query reformulation and abandonment.
- Exact-product precision at `k`.
- Substitute relevance at `k`.
- Hard-constraint violation rate.
- Accessory-versus-main-product error rate.
- Duplicate product/offer rate.
- Product identity precision and recall.
- Mission slot coverage and budget compliance.
- Unique product, merchant, and source-class coverage.
- Source dominance and source-class dominance.
- Direct/authorized merchant coverage.
- Evidence coverage and cross-source corroboration.
- Price, stock, and shipping freshness.
- Correction and complaint rate.
- Recommendation disagreement rate and whether it was resolved.

Offline relevance and diversity metrics are necessary regression tests but not proof of customer
value. They must be connected to user behavior and later outcomes.

### 8.4 Trust and monetization guardrails

- Correlation between affiliate rate/revenue and organic rank.
- Percentage of top results without an affiliate relationship.
- Sponsored-unit recognition and disclosure comprehension.
- Source/provenance inspection rate.
- Evidence correction latency.
- Merchant revenue concentration.
- Source outage concentration risk.
- Percentage of recommendations with explicit material uncertainty.
- Percentage of claims supported only by first-party sources.

The target for commission influence on organic rank is zero by design, not merely a low observed
correlation.

### 8.5 Consumer business metrics

- Gross affiliate contribution per completed decision.
- Variable data and inference cost per decision.
- Contribution margin by category and mission type.
- Outbound click-to-attributed-purchase conversion.
- Refund, cancellation, and attribution-loss rates.
- Organic, extension, referral, MCP/agent, partner, and paid CAC separately.
- Repeat research rate by cohort.
- Ownership-alert retention and return visits.
- Free-to-one-off-paid conversion.
- Free-to-member conversion.
- Paid retention, refund, and support cost.
- Revenue concentration by merchant, category, and acquisition channel.

Do not blend organic and paid acquisition into one CAC number. A model can look healthy only
because free early-adopter traffic masks unscalable paid acquisition.

### 8.6 B2B metrics, if a later product is validated

For retailer search or diagnostics:

- Search conversion versus browse conversion.
- Revenue and gross profit per search session.
- Add-to-cart and purchase rate after search.
- Zero-result, low-result, and irrelevant-result rates.
- Search exit and reformulation rates.
- Time to first relevant click.
- Catalog and attribute completeness.
- Search latency, freshness, and uptime.
- Manual merchandising hours and integration hours.
- Long-tail product/supplier exposure.

For a data/product graph API:

- Entity-match precision and recall.
- Variant and compatibility accuracy.
- Unique offer and merchant coverage.
- Price/availability accuracy and refresh lag.
- Query/product coverage.
- `p95`/`p99` latency and uptime.
- Cost per resolved product or query.
- Correction rate and provenance completeness.

Claims of incremental conversion or revenue require randomized A/B tests. The basic customer ROI
formula is:

```text
ROI = (incremental gross profit + measured labor savings - Scour fees) / Scour fees
```

Revenue without gross margin can substantially exaggerate merchant value.

---

## 9. Validation plan

### Phase 0: establish the baseline

- Preserve the frozen benchmark and current ranking snapshot.
- Measure result-source composition and source-class composition.
- Instrument successful searches, shortlists, outbound clicks, corrections, and explicit user
  feedback without constructing invasive user profiles.
- Record offer and evidence freshness.
- Calculate variable cost per query and mission.

### Phase 1: one narrow high-consideration wedge

Choose one category or life-event mission with:

- Meaningful purchase value and mistake cost.
- Strong product identifiers.
- Several authorized merchants.
- Available expert, owner, community, and safety evidence.
- Reasonable affiliate economics.
- A reachable user community.

Build concierge-quality briefs for a small cohort. Manual research is acceptable here because
the goal is to learn which information changes decisions before automating the wrong workflow.

Every brief should include:

- Diverse offers.
- Explicit hard requirements.
- Three to five finalists.
- Price and seller context.
- Independent evidence.
- Owner/community failure modes.
- Ownership and safety considerations.
- Unknowns and disagreements.

### Phase 2: test the product mechanism

Compare the existing result page with the decision-brief experience. Measure:

- Ability to identify a relevant finalist.
- Decision time.
- Constraint violations.
- Search restarts elsewhere.
- Confidence calibration, not only confidence.
- Recall of important trade-offs.
- Purchase/shortlist completion.

Do not rely only on "Which version do you prefer?" Preference surveys reward attractive
interfaces and confident prose without proving better decisions.

### Phase 3: test real willingness to pay

- Offer a real one-off deep brief after users begin a qualifying high-consideration task.
- Randomize honest price points across cohorts.
- Clearly disclose what the user will receive and deliver it.
- Measure purchase and refund behavior, not hypothetical willingness.
- Later test annual ownership membership only after recurring ownership features exist.

An ethical fake-door test may measure clicks before full automation, but it must disclose that the
feature is not yet available before taking payment and must not mislead the user about delivery.

### Phase 4: measure durable outcomes

Follow up after 30 and 90 days:

- Purchase and return status.
- Requirement satisfaction.
- Regret and willingness to choose again.
- Product failure or incompatibility.
- Whether Scour missed decisive evidence.
- Whether ownership alerts created value.

### Phase 5: evaluate economics by channel

- Calculate contribution margin by category.
- Compare extension, shared brief, community, MCP/agent, organic search, partner, and paid
  acquisition.
- Measure lifetime repeat research conservatively.
- Stress-test loss of the largest affiliate merchant.
- Stress-test loss of the largest acquisition channel.
- Do not scale paid acquisition until contribution LTV is credibly above CAC with a margin for
  uncertainty and overhead.

### Precommitted falsification conditions

The positioning or business model should be revised if:

- Diverse evidence does not materially change shortlists or eliminate bad candidates.
- Users do not decide faster or achieve better post-purchase outcomes.
- Users use Scour primarily as another path to Amazon.
- Attributable contribution cannot cover variable and acquisition costs.
- Real paid conversion is negligible even for consequential purchases.
- Users do not return for ownership services.
- Reliable source rights make the evidence portfolio economically infeasible.
- Affiliate monetization cannot be kept independent of recommendation order.
- A narrow category performs well but does not transfer; in that case Scour may be a valuable
  vertical product rather than a universal shopping engine.

---

## 10. Product and data roadmap

### Immediate: credibility before coverage claims

- Replace "every store" or equivalent exhaustive claims with language that matches measured
  coverage.
- Surface unique products and source roles rather than listing count.
- Make the current source mix and missing source classes visible internally.
- Restore working official retailer integrations where possible.
- Treat Reddit/community content as evidence, not inventory.
- Add CPSC recall matching for supported categories.
- Capture structured product identifiers and variant attributes.
- Continue relevance, clustering, mission, and source-diversity evaluation.

### Next: evidence graph and decision brief

- Separate product entities, offers, sources, claims, and evidence records in the data model.
- Add provenance, extraction time, verification time, and claim type.
- Add requirement-satisfaction and disqualifier presentation.
- Add source disagreement and missing-evidence states.
- Add landed-cost and observed-price-history logic.
- Add seller authority/condition distinctions.
- Retrieve representative community discussions under appropriate rights.
- Build shareable research briefs.

### Then: ownership loop

- Recall and safety alerts.
- Warranty and return deadlines.
- Price-protection or post-purchase price alerts where appropriate.
- Maintenance schedules and consumables.
- Parts, repair, support-horizon, and resale tracking.
- Household product record.

### Only after evidence of demand

- Paid one-off dossiers.
- Annual consumer membership.
- Licensed expert evidence.
- B2B2C distribution partnerships.
- Search-quality diagnostics or a licensed product graph API.

---

## 11. Legal, ethical, and operational risks

### Data rights and platform dependence

- Public accessibility does not imply a right to scrape, cache, republish, or commercialize data.
- Affiliate APIs can restrict caching, images, display, attribution, and paid traffic.
- Community platforms can require commercial agreements.
- Editorial test results may be copyright-protected and contractually restricted.
- Merchant feeds may allow consumer referrals but forbid data resale or B2B API redistribution.

Every source needs a recorded rights basis, permitted fields, retention rules, required
attribution, and termination plan.

### Consumer deception

- Do not call the service independent if commercial influence affects organic rank.
- Do not describe a source as verified without defining verification.
- Do not present inferred compatibility, safety, or ownership cost as fact.
- Do not claim exhaustive coverage.
- Do not claim savings without a defensible counterfactual.
- Do not summarize community sentiment without showing selection and uncertainty.

### Safety and high-stakes categories

Scour should be particularly conservative with baby products, health products, electrical safety,
vehicles, and financial consequences. It needs authoritative matching, clear dates/jurisdictions,
and a correction process. A fluent LLM summary is not an adequate safety control.

### Privacy

Preference elicitation can improve results, but Scour should avoid building an unnecessary
behavioral-advertising profile. Store the minimum information needed for the user's decision and
ownership services, provide deletion/export controls, and do not repurpose community identities.

### Operational fragility

HTML adapters can fail without warning. A source watchdog helps detect failure but does not grant
access or guarantee repair. Production reliability requires official feeds, redundant source
classes, freshness SLAs, and graceful uncertainty when a source is unavailable.

---

## 12. Decisions and open hypotheses

### Recommended decisions now

- Treat Scour as a B2C consumer decision product.
- Position around difficult, consequential purchases rather than exhaustive catalog size.
- Build source-role diversity and an evidence graph.
- Keep organic ranking independent of merchant payment.
- Use a free affiliate-funded core during validation.
- Test one-off consumer payment before a subscription-first model.
- Build ownership services as the strongest recurring-value path.
- Do not pivot to retailer SaaS until a specific buyer and differentiated product are validated.
- Measure post-purchase satisfaction, regret, and returns.

### Hypotheses still requiring evidence

- "Make a purchase you can defend" resonates better than a price/coverage message.
- High-consideration durable goods produce sufficient affiliate contribution.
- Users will pay once for a deep decision brief.
- Ownership services create annual retention.
- Diverse evidence improves actual choices, not only perceived trust.
- Browser extension, shared briefs, communities, MCP/agent integrations, or B2B2C partners can
  acquire users below contribution LTV.
- A horizontal evidence graph can be built without category-specific quality collapsing.

---

## 13. Research reference index

### Consumer decision-making and search economics

- Chernev, Böckenholt, and Goodman,
  [Choice overload: A conceptual review and meta-analysis](https://doi.org/10.1016/j.jcps.2014.08.002).
- Karle, Kerzenmacher, Schumacher, and Verboven,
  [Search Costs and Context Effects](https://www.aeaweb.org/articles?id=10.1257%2Fmic.20240115).
- Lehmann, Herrmann, and Heitmann,
  [Choice Goal Attainment and Decision and Consumption Satisfaction](https://business.columbia.edu/faculty/research/choice-goal-attainment-and-decision-and-consumption-satisfaction).
- Ellison and Ellison,
  [Search and Obfuscation in a Technologically Changing Retail Environment](https://www.journals.uchicago.edu/doi/full/10.1086/694405).
- Ellison and Ellison,
  [Search, Obfuscation, and Price Elasticities on the Internet](https://economics.mit.edu/sites/default/files/publications/Search%2C%20Obfuscatuibm%20and%20Price%20Elasticities%20on%20the.pdf).

### Algorithms, explanations, and trust

- Logg, Minson, and Moore,
  [Algorithm Appreciation](https://escholarship.org/uc/item/9v38k9m6).
- Dietvorst, Simmons, and Massey,
  [Overcoming Algorithm Aversion](https://pubsonline.informs.org/doi/abs/10.1287/mnsc.2016.2643).
- Wang, Xu, and Wang,
  [Recommendation Neutrality and Sponsorship Disclosure](https://pubsonline.informs.org/doi/abs/10.1287/mnsc.2017.2906).
- [Consumer-based decision aid that explains which to buy](https://www.sciencedirect.com/science/article/pii/S0167923611002478).

### Search, diversity, identity, and review quality

- [Amazon ESCI shopping-query dataset](https://arxiv.org/abs/2206.06588).
- [xQuAD result diversification](https://eprints.gla.ac.uk/44352/).
- [Popularity-bias evaluation](https://arxiv.org/abs/2006.04275).
- [FairMatch exposure-bias mitigation](https://research.tue.nl/en/publications/a-graph-based-approach-for-mitigating-multi-sided-exposure-bias-i/).
- [Web Data Commons large-scale product-matching corpus](https://www.webdatacommons.org/largescaleproductcorpus/).
- He, Hollenbeck, and Proserpio,
  [The Market for Fake Reviews](https://pubsonline.informs.org/doi/10.1287/mksc.2022.1353).
- [FTC Consumer Reviews and Testimonials Rule Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers).

### Official commerce, structured data, and safety sources

- [eBay Browse API](https://developer.ebay.com/develop/api/buy/browse_api).
- [Best Buy Products API](https://developers.bestbuy.com/apis).
- [Etsy Open API v3](https://developers.etsy.com/documentation/).
- [Reddit Data API Terms](https://redditinc.com/policies/data-api-terms).
- [Amazon Associates policies](https://affiliate-program.amazon.com/help/operating/policies).
- [Schema.org AggregateOffer](https://schema.org/AggregateOffer).
- [CPSC Recalls API](https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information).

### Business-model and market comparables

- [Consumer Reports 2025 impact report](https://www.consumerreports.org/annual-report/2025/impact/).
- [Consumer Reports 2025 financials](https://www.consumerreports.org/annual-report/2025/financials/).
- [Consumer Reports membership pricing](https://www.consumerreports.org/membership).
- [New York Times 2025 10-K](https://www.sec.gov/Archives/edgar/data/71691/000007169126000011/nyt-20251231.htm).
- [NerdWallet 2025 10-K](https://www.sec.gov/Archives/edgar/data/1625278/000162527826000014/nrds-20251231.htm).
- [trivago 2025 annual filing](https://www.sec.gov/Archives/edgar/data/1683825/000168382526000006/trvg-20251231.htm).
- [Baymard 2026 ecommerce-search benchmark](https://baymard.com/blog/ecommerce-search-query-types).
- [Algolia KIKO case study](https://www.algolia.com/customers/kiko).
- [Algolia Al-Futtaim case study](https://www.algolia.com/customers/al-futtaim-group).

---

## Final strategic statement

Scour should not try to win by returning the largest pile of links. It should win by helping a
consumer reach a well-supported decision while exposing the evidence, incentives, trade-offs, and
uncertainties that ordinary commerce search conceals.

The immediate engineering goal is therefore not "add more websites" in isolation. It is:

> **Build a rights-respecting, provenance-preserving product and evidence graph that supplies
> relevant products, genuinely diverse offers, independent evidence, and a calibrated shortlist
> for a narrow set of consequential purchase decisions. Then prove that it improves outcomes and
> can be acquired and monetized economically.**
