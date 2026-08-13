import { formatPrice } from '@/lib/format'
import type {
  MissionBundle,
  MissionPick,
  MissionResult,
} from '@/lib/mission'
import type { MissionPlan } from '@/lib/llm/mission-planner'

export function MissionResults({ result }: { result: MissionResult }) {
  return (
    <div className="flex flex-col gap-8">
      <Plan result={result} />
      {result.plan.composition === 'bundle' ? (
        <BundleResults result={result} />
      ) : (
        <AlternativeResults result={result} />
      )}
    </div>
  )
}

function Plan({ result }: { result: MissionResult }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">
            {result.plan.composition === 'bundle' ? 'Multi-item plan' : 'Idea plan'}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-fg">{result.plan.summary}</h2>
        </div>
        <span className="font-mono text-[11px] text-fg-subtle">
          {result.candidatesConsidered} candidates · {result.storesSearched} stores
        </span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {result.plan.recipient && <Chip label={`for ${result.plan.recipient}`} />}
        {result.plan.occasion && <Chip label={result.plan.occasion} />}
        {(result.plan.budgetMinMinor != null || result.plan.budgetMaxMinor != null) && (
          <Chip label={formatBudget(result.plan)} />
        )}
        {result.plan.criteria.map((criterion) => (
          <Chip key={criterion} label={criterion} muted />
        ))}
      </div>
      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {result.plan.queries.map((query) => {
          const link = result.scourSearchUrls.find(
            (search) => search.q.includes(query.q) || search.q === query.q,
          )
          return (
            <li key={query.q} className="rounded-lg border border-border bg-bg px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-fg">{query.q}</div>
                  <div className="text-xs text-fg-muted">{query.reason}</div>
                </div>
                {link && (
                  <a
                    href={link.url}
                    className="shrink-0 font-mono text-[10px] text-accent hover:underline"
                  >
                    search →
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function BundleResults({ result }: { result: MissionResult }) {
  if (result.bundles.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <SectionTitle title="Complete setups" />
        <p className="rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm text-fg-muted">
          Scour found options in some categories, but couldn’t assemble a complete package
          inside the total budget. Try raising the budget or open a category search below.
        </p>
        <SlotFallback result={result} />
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <SectionTitle title="Complete setups" />
        <p className="text-xs text-fg-muted">Each package includes one item per plan category.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {result.bundles.map((bundle) => (
          <BundleCard key={bundle.id} bundle={bundle} />
        ))}
      </div>
    </section>
  )
}

function BundleCard({ bundle }: { bundle: MissionBundle }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-border bg-bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h3 className="font-semibold text-fg">{bundle.label}</h3>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">{bundle.description}</p>
        </div>
        <span className="shrink-0 font-mono text-base font-bold text-accent-strong">
          {formatPrice(bundle.totalMinor, bundle.currency)}
        </span>
      </div>
      <div className="flex flex-1 flex-col divide-y divide-border">
        {bundle.items.map((item) => (
          <ProductRow key={`${item.query}-${item.url}`} item={item} compact />
        ))}
      </div>
    </article>
  )
}

function AlternativeResults({ result }: { result: MissionResult }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <SectionTitle title="Diverse shortlist" />
        <p className="text-xs text-fg-muted">Ideas are balanced across the planned categories.</p>
      </div>
      {result.picks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-bg-card p-8 text-center text-sm text-fg-muted">
          No strong picks this run—try a more specific goal or adjust the budget.
        </p>
      ) : (
        <ol className="grid gap-3 md:grid-cols-2">
          {result.picks.map((item) => (
            <li key={`${item.rank}-${item.url}`} className="overflow-hidden rounded-xl border border-border bg-bg-card">
              <ProductRow item={item} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function SlotFallback({ result }: { result: MissionResult }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {result.slots.map((slot) => (
        <section key={slot.query.q} className="rounded-xl border border-border bg-bg-card p-3">
          <h3 className="mb-2 text-sm font-semibold text-fg">{slot.query.q}</h3>
          {slot.picks.length === 0 ? (
            <p className="text-xs text-fg-muted">No strong match in this category.</p>
          ) : (
            <div className="divide-y divide-border">
              {slot.picks.map((item) => (
                <ProductRow key={item.url} item={item} compact />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

function ProductRow({ item, compact = false }: { item: MissionPick; compact?: boolean }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-3 p-3 transition-colors hover:bg-bg-hover"
    >
      <div className={`${compact ? 'h-12 w-12' : 'h-16 w-16'} flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg-elevated`}>
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="text-fg-subtle" aria-hidden>◇</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-xs font-semibold leading-snug text-fg group-hover:text-accent-strong">
          {item.title}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px]">
          <span className="truncate text-fg-muted">{item.query} · {item.store}</span>
          <span className="shrink-0 font-bold text-fg">
            {formatPrice(item.priceMinor, item.currency)}
          </span>
        </div>
      </div>
    </a>
  )
}

function SectionTitle({ title }: { title: string }) {
  return <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-fg">{title}</h2>
}

function Chip({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <span
      className={
        muted
          ? 'rounded-full border border-border bg-bg px-2.5 py-0.5 text-fg-muted'
          : 'rounded-full border border-accent/30 bg-accent-soft px-2.5 py-0.5 text-accent-strong'
      }
    >
      {label}
    </span>
  )
}

function formatBudget(plan: MissionPlan): string {
  const scope = plan.composition === 'bundle' ? 'total' : 'item'
  if (plan.budgetMinMinor != null && plan.budgetMaxMinor != null) {
    return `${scope} ${formatPrice(plan.budgetMinMinor, 'USD')}–${formatPrice(plan.budgetMaxMinor, 'USD')}`
  }
  if (plan.budgetMinMinor != null) {
    return `${scope} ≥ ${formatPrice(plan.budgetMinMinor, 'USD')}`
  }
  return `${scope} ≤ ${formatPrice(plan.budgetMaxMinor!, 'USD')}`
}
