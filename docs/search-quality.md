# Search quality evaluation

Search changes should be measured against the frozen benchmark in
`benchmarks/search-quality.v1.json`. It covers the failures already seen in the
product plus exact models, attributes, compatibility, budgets, misspellings,
missions, diversity, and source outages.

Do not silently edit judgments to make a new ranker pass. Material label or
query changes require a new benchmark version so old and new scores remain
comparable.

## Running an offline evaluation

Create a prediction snapshot containing one or more runs:

```json
{
  "runs": [
    {
      "caseId": "regression-ps5-xbox",
      "runId": "candidate-a-1",
      "predictedIntent": "mission",
      "results": [
        {
          "resultId": "amazon:B0EXAMPLE",
          "entityId": "sony-ps5-slim-disc",
          "title": "Sony PlayStation 5 Slim Disc Console",
          "source": "Amazon",
          "priceMinor": 49900,
          "currency": "USD",
          "slotId": "playstation"
        }
      ],
      "bundles": [
        {
          "id": "comparison-1",
          "items": [
            { "resultId": "amazon:B0EXAMPLE", "slotId": "playstation" },
            { "resultId": "ebay:123", "slotId": "xbox" }
          ]
        }
      ]
    }
  ]
}
```

Then run:

```bash
npx tsx scripts/evaluate-search.ts /path/to/predictions.json --strict
```

To capture the application itself instead of hand-authoring a prediction file:

```bash
npm run quality:capture -- --case=regression-blundstone-leather --repeat=3 --output=/tmp/scour-quality.json
npm run quality:eval -- /tmp/scour-quality.json --benchmark=benchmarks/search-quality.v1.json
```

Omit `--case` to run the full frozen suite. Capture uses live enabled shopping
sources, so source credentials, retailer availability, and total runtime affect
the snapshot; the evaluator remains deterministic once the file is captured.

An item can contain an explicit human `relevance` label (`exact`,
`substitute`, `complement`, or `irrelevant`). When it does not, the evaluator
uses the frozen lexical judgments. Explicit labels make the same evaluator
usable with a future human-judged pool.

Run each candidate configuration at least three times. The report measures
top-10 Jaccard repeatability across runs with the same case ID.

## Metrics and release gates

- Intent accuracy: product versus mission routing.
- nDCG@10: graded ESCI-style relevance (`exact > substitute > complement > irrelevant`).
- Precision@5: exact or substitute results in the first five positions.
- Constraint leakage@10: results violating price, currency, required-attribute,
  or exclusion rules. Lower is better.
- Duplicate rate@10: repeated canonical entities, falling back to normalized
  titles when no entity ID exists. Lower is better.
- Unique entities and sources@10 plus normalized source entropy: diversity
  diagnostics, not targets to maximize without regard to relevance.
- Mission slot coverage: fraction of required categories represented.
- Complete bundle rate: fraction of packages containing every required slot
  exactly once.
- Repeatability@10: overlap between repeated executions of the same query.

Initial merge gates should be relative: no drop in intent accuracy or
Precision@5, no increase in constraint leakage, and no material nDCG@10 loss.
Only then optimize entity/source diversity.

## Production telemetry

Search completion diagnostics are stored server-side in `SearchRun`; explicit
yes/no judgments are stored in `SearchFeedback` through
`POST /api/search-feedback`. The normalized query is SHA-256 hashed before it
is written. Raw queries, prompts, IP addresses, cookies, and API keys are not
stored in this quality stream.

```ts
type SearchTelemetryEvent = {
  schemaVersion: 1
  event: 'search_completed' | 'result_clicked' | 'result_saved'
  searchId: string
  occurredAt: string
  queryHash: string
  benchmarkCaseId?: string
  intent?: 'product' | 'mission'
  intentConfidence?: number
  durationMs?: number
  usedFallback?: boolean
  adaptersAttempted?: number
  adaptersSucceeded?: number
  candidatesRetrieved?: number
  resultsShown?: number
  uniqueEntitiesShown?: number
  uniqueSourcesShown?: number
  constraintViolationsShown?: number
  missionSlotsPlanned?: number
  missionSlotsCovered?: number
  completeBundles?: number
  resultId?: string
  entityId?: string
  sourceId?: string
  rank?: number
}
```

Set `SEARCH_TELEMETRY_HASH_KEY` in production to use an HMAC of the normalized
query for aggregation (local development falls back to SHA-256). Do not store raw
queries, prompts, IP addresses, or API keys in this quality stream. Attach a
short-lived `searchId` to result links/buttons so clicks and saves can be joined
to the impression. Sample anonymous searches if volume demands it, but retain
all benchmark and regression runs.

Keep a documented retention period before deploying at scale. If click/save
telemetry is added later, use a short-lived search ID and randomized exposure
propensities; raw click position is not an unbiased relevance label.
