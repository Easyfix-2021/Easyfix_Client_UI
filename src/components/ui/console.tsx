/**
 * Console primitives — the shared visual grammar of the client portal.
 *
 * WHAT THIS IS. The portal is being moved from a dark left sidebar to a light
 * top-nav console, matching the design shared by the client team. That design
 * is not a skin: it is a small, strict grammar repeated on every screen —
 *
 *   an uppercase SECTION LABEL over every block,
 *   STAT CARDS carrying one number each behind a coloured left rule,
 *   PANELS with a title row and hairline border,
 *   ROWS of "thing · context · age · action",
 *   FILTER CHIPS in the page header.
 *
 * Six screens each re-inventing that grammar is how a console stops looking
 * like one product. So it lives here once, and screens compose it.
 *
 * IN OUR IDENTITY, NOT THE MOCK'S. The shared screenshot is built on stock blues
 * and purples. Every colour below is an EasyFix token instead: red is action,
 * ink is text, blue is money and information, gold is earned, and the meaning
 * colours are used only for meaning. Where the mock reached for a hue purely to
 * separate one card from its neighbour, that is `accent` — a documented
 * semantic choice per card, never a decorative hue picked by eye.
 *
 * Everything here obeys scripts/check-brand-tokens.js: tokens only, no colour
 * literals, weights at or below 600, no type under 12px.
 */
'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ─── accents ──────────────────────────────────────────────────────────────
 * The five meanings a block can carry. A caller names the MEANING; this table
 * decides the colour, so the mock's blue/green/amber never leaks into a screen.
 */
export type Accent = 'brand' | 'info' | 'success' | 'warning' | 'money';

const ACCENT_RULE: Record<Accent, string> = {
  brand: 'border-l-primary',
  info: 'border-l-info',
  success: 'border-l-success',
  warning: 'border-l-warning',
  money: 'border-l-money',
};

const ACCENT_TEXT: Record<Accent, string> = {
  brand: 'text-primary',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  money: 'text-money',
};

/* ─── section label ────────────────────────────────────────────────────────
 * "TODAY'S PULSE", "YOUR ACTION QUEUE". Uppercase and tracked so it reads as a
 * divider rather than a heading — the panels below carry the real headings.
 * text-xs is the 12px floor; the tracking is what makes it legible that small.
 */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn('text-xs font-semibold uppercase tracking-[0.14em] text-ink-500 mb-3', className)}>
      {children}
    </h2>
  );
}

/* ─── stat card ────────────────────────────────────────────────────────────
 * One number, one meaning. The coloured rule is on the LEFT edge rather than
 * behind the whole card: a full tint would put five saturated grounds side by
 * side and make the numbers — the actual content — the least prominent thing
 * in the row.
 */
export function StatCard({
  icon: Icon, label, value, sub, accent = 'brand', onClick, className,
}: {
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
  /** The one-line context under the number ("42 due today · 141 scheduled"). */
  sub?: ReactNode;
  accent?: Accent;
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'w-full h-full text-left bg-surface rounded-xl border border-ink-100 border-l-4 px-4 py-3.5',
        'transition hover:shadow-sm',
        onClick && 'cursor-pointer hover:border-ink-300',
        ACCENT_RULE[accent],
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-ink-500">
        {Icon ? <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden /> : null}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold text-ink-900 tabular-nums leading-tight">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-ink-500">{sub}</div> : null}
    </Tag>
  );
}

/** The row the stat cards sit in. Wraps rather than scrolls on small screens. */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4', className)}>{children}</div>
  );
}

/* ─── panel ────────────────────────────────────────────────────────────────
 * The workhorse container. `accent` tints only the BORDER, for a panel that
 * needs to read as urgent (the action queue) without becoming a red box.
 */
export function Panel({
  title, action, accent, children, className, bodyClassName,
}: {
  title?: ReactNode;
  /** Top-right affordance — a "View All →" link or a count pill. */
  action?: ReactNode;
  accent?: Accent;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        /*
         * NO h-full HERE, deliberately.
         *
         * Aligning cards across a row is the CONTAINER's job — give the wrapper
         * `flex flex-col` and the Panel `className="flex-1"` (see the dashboard),
         * or let SplitLayout do it. A blanket `h-full` looks correct until a
         * Panel is used standalone: <main> is a flex item with flex-1, so it has
         * a DEFINITE height, and `height: 100%` on a direct child of it resolves
         * to the whole main area. A standalone "by city" card ballooned to
         * full-page height and collided with the section under it.
         *
         * `min-w-0` is the width half of the same problem: without it a wide
         * DataTable inside can push the card past its track instead of scrolling
         * within it.
         */
        'bg-surface rounded-xl border border-ink-100 flex flex-col min-w-0',
        accent === 'brand' && 'border-primary/30',
        accent === 'warning' && 'border-warning/40',
        className,
      )}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ink-100">
          <div className="text-sm font-semibold text-ink-900 min-w-0">{title}</div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
      <div className={cn('px-4 py-3 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ─── rows ─────────────────────────────────────────────────────────────────
 * "Estimate approval — LKST2028 Ajmer / Carpentry · Sent 18 Jul / 10d waiting /
 * [Approve]". Title, context, age, action — the shape every queue in the
 * console uses.
 */
export function ListRow({
  title, sub, age, ageAccent = 'warning', action, className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** Short age string — "10d waiting", "2–3d". */
  age?: ReactNode;
  ageAccent?: Accent;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 py-2.5 border-b border-ink-100 last:border-0', className)}>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink-900 truncate">{title}</div>
        {sub ? <div className="text-xs text-ink-500 truncate">{sub}</div> : null}
      </div>
      {age ? <Pill accent={ageAccent}>{age}</Pill> : null}
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ─── pill ─────────────────────────────────────────────────────────────────
 * A tint plus its on-tint text — never a solid fill, so a row can carry two or
 * three without turning into a traffic light.
 */
const PILL: Record<Accent, string> = {
  brand: 'bg-primary-50 text-primary',
  info: 'bg-info-tint text-info-text',
  success: 'bg-success-tint text-success-text',
  warning: 'bg-warning-tint text-warning-text',
  money: 'bg-money/10 text-money',
};

export function Pill({
  children, accent = 'info', className,
}: { children: ReactNode; accent?: Accent; className?: string }) {
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums', PILL[accent], className)}>
      {children}
    </span>
  );
}

/* ─── filter chip ──────────────────────────────────────────────────────────
 * "All cities", "This month". A resting chip is neutral; an ACTIVE filter is
 * brand red, because a filter silently narrowing the numbers is the thing a
 * reader most needs to notice.
 */
export function FilterChip({
  icon: Icon, children, active = false, onClick, className,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'border-primary bg-primary-50 text-primary'
          : 'border-ink-100 bg-surface text-ink-700 hover:border-ink-300',
        className,
      )}
    >
      {Icon ? <Icon className="w-3.5 h-3.5" aria-hidden /> : null}
      {children}
    </button>
  );
}

/* ─── page header ──────────────────────────────────────────────────────────
 * Title and freshness on the left, filters on the right. Every screen opens
 * with one, so "where am I and how current is this?" is answered identically
 * everywhere.
 */
export function PageHeader({
  title, sub, filters, className,
}: { title: ReactNode; sub?: ReactNode; filters?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 mb-5', className)}>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-ink-900 leading-tight">{title}</h1>
        {sub ? <div className="text-xs text-ink-500 mt-0.5">{sub}</div> : null}
      </div>
      {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
    </div>
  );
}

/* ─── metric row ───────────────────────────────────────────────────────────
 * A labelled figure with an optional delta and a proportion bar — the
 * "SLA compliance 84% ↑3%" shape from Performance Health.
 */
/*
 * The proportion bar, shared by MetricRow and RankedList.
 *
 * Extracted when the second consumer arrived, not before: two copies of a
 * clamp and a colour map is exactly how one of them ends up rounding
 * differently from the other and two bars of the same value stop matching.
 * Clamps to 0–1 so a ratio computed against a stale denominator overflows its
 * track instead of painting past it.
 */
const BAR_FILL: Record<Accent, string> = {
  brand: 'bg-primary', info: 'bg-info', success: 'bg-success',
  warning: 'bg-warning', money: 'bg-money',
};

export function Bar({ value, accent = 'success' }: { value: number; accent?: Accent }) {
  return (
    <div className="mt-1.5 h-1 rounded-full bg-ink-100 overflow-hidden">
      <div
        className={cn('h-full rounded-full', BAR_FILL[accent])}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

export function MetricRow({
  label, value, delta, deltaAccent = 'success', bar, barAccent = 'success',
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  deltaAccent?: Accent;
  /** 0–1. Omit for a figure with no meaningful proportion (an average age). */
  bar?: number;
  barAccent?: Accent;
}) {
  return (
    <div className="py-2.5 border-b border-ink-100 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink-700 min-w-0 truncate">{label}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-sm font-semibold text-ink-900 tabular-nums">{value}</span>
          {delta ? <span className={cn('text-xs', ACCENT_TEXT[deltaAccent])}>{delta}</span> : null}
        </span>
      </div>
      {typeof bar === 'number' ? <Bar value={bar} accent={barAccent} /> : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PART TWO — the shapes the five reference screens add on top of the basics.
 *
 * Home gave us labels, stat cards, panels and rows. Open jobs, Completed,
 * Performance and Invoicing add four more ideas, and every one of them recurs:
 *
 *   a TOOLBAR of filters above a list,
 *   a LIST beside a DETAIL PANE (select left, act right),
 *   a TABLE with a status column and a per-row action,
 *   a KPI against a TARGET.
 *
 * Same rule as above: a caller names the meaning, this file picks the colour.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ─── status pill ──────────────────────────────────────────────────────────
 * The console has one vocabulary of outcome words — "On track", "At risk",
 * "Paid", "Excellent" — and they must mean the same colour on every screen.
 * Mapping them HERE, once, is what stops Invoicing inventing a different green
 * from Performance.
 */
export type Status =
  | 'on-track' | 'watch' | 'at-risk'
  | 'excellent' | 'partial'
  | 'paid' | 'acknowledged' | 'sent'
  | 'neutral';

const STATUS: Record<Status, { label: string; accent: Accent }> = {
  'on-track': { label: 'On track', accent: 'success' },
  watch: { label: 'Watch', accent: 'warning' },
  'at-risk': { label: 'At risk', accent: 'brand' },
  excellent: { label: 'Excellent', accent: 'success' },
  partial: { label: 'Partial', accent: 'warning' },
  paid: { label: 'Paid', accent: 'success' },
  acknowledged: { label: 'Acknowledged', accent: 'info' },
  sent: { label: 'Sent', accent: 'warning' },
  neutral: { label: '—', accent: 'info' },
};

export function StatusPill({ status, children }: { status: Status; children?: ReactNode }) {
  const s = STATUS[status];
  return <Pill accent={s.accent}>{children ?? s.label}</Pill>;
}

/* ─── toolbar ──────────────────────────────────────────────────────────────
 * The filter row above a list. `count` is the right-aligned "183 open jobs"
 * — deliberately plain text, not a pill: it is a readout of what the filters
 * did, not another control.
 */
export function Toolbar({ children, count, className }: { children: ReactNode; count?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 mb-3', className)}>
      {children}
      {count ? <span className="ml-auto text-xs text-ink-500 tabular-nums">{count}</span> : null}
    </div>
  );
}

/* ─── segmented control ────────────────────────────────────────────────────
 * "This week · This month · Last month · Quarter" and "City · Zone · State ·
 * SPOC". One choice from a small closed set, so it is a segmented control
 * rather than chips — chips read as independent toggles.
 */
export function Segmented<T extends string>({
  options, value, onChange, className,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex rounded-lg border border-ink-100 bg-surface p-0.5', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-md transition whitespace-nowrap',
            o.value === value ? 'bg-primary-50 text-primary' : 'text-ink-500 hover:text-ink-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ─── age band ─────────────────────────────────────────────────────────────
 * The five-bucket ageing strip above Open jobs. It is a FILTER as well as a
 * readout — clicking a bucket narrows the list — so the selected bucket is
 * tinted, not merely outlined.
 */
export function AgeBand({
  buckets, selected, onSelect, className,
}: {
  buckets: ReadonlyArray<{ key: string; label: string; value: number; sub?: string; accent?: Accent }>;
  selected?: string | null;
  onSelect?: (key: string | null) => void;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border border-ink-100 rounded-xl overflow-hidden bg-surface', className)}>
      {buckets.map((b) => {
        const on = selected === b.key;
        return (
          <button
            key={b.key}
            type="button"
            onClick={() => onSelect?.(on ? null : b.key)}
            aria-pressed={on}
            className={cn(
              'px-3 py-2.5 text-center border-r border-ink-100 last:border-r-0 transition',
              on ? 'bg-primary-50' : 'hover:bg-surface-alt',
            )}
          >
            <div className="text-xs text-ink-500">{b.label}</div>
            <div className={cn('text-lg font-semibold tabular-nums', on ? 'text-primary' : ACCENT_TEXT[b.accent ?? 'info'])}>
              {b.value}
            </div>
            {b.sub ? <div className="text-xs text-ink-300">{on ? `${b.sub} · selected` : b.sub}</div> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ─── kpi card ─────────────────────────────────────────────────────────────
 * A figure judged against a TARGET. The bar is progress toward that target,
 * and `good` says which direction is better — a revisit rate falling is good,
 * an SLA rate falling is not, and the arrow must not imply otherwise.
 */
export function KpiCard({
  label, value, delta, deltaDirection, good = 'up', target, progress, accent = 'info',
}: {
  label: ReactNode;
  value: ReactNode;
  /** "3% vs July" — the magnitude only; the arrow is derived. */
  delta?: ReactNode;
  deltaDirection?: 'up' | 'down';
  /** Which direction counts as an improvement for THIS metric. */
  good?: 'up' | 'down';
  target?: ReactNode;
  /** 0–1 toward target. */
  progress?: number;
  accent?: Accent;
}) {
  const improving = deltaDirection ? deltaDirection === good : undefined;
  return (
    <div className={cn('bg-surface rounded-xl border border-ink-100 border-l-4 px-4 py-3', ACCENT_RULE[accent])}>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold text-ink-900 tabular-nums leading-tight">{value}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        {delta ? (
          <span className={cn('text-xs', improving === undefined ? 'text-ink-500' : improving ? 'text-success' : 'text-danger')}>
            {deltaDirection === 'down' ? '↓' : '↑'} {delta}
          </span>
        ) : <span />}
        {target ? <span className="text-xs text-ink-500">{target}</span> : null}
      </div>
      {typeof progress === 'number' ? <Bar value={progress} accent={accent} /> : null}
    </div>
  );
}

/* ─── banner ───────────────────────────────────────────────────────────────
 * A full-width statement above the content — "Your approval response rate …
 * 61%", "Pune needs attention …". Tint plus on-tint text, never a solid fill:
 * these sit between sections and a solid band would cut the page in half.
 */
const BANNER: Record<Accent, string> = {
  brand: 'bg-primary-50 text-primary-dark border-primary/20',
  info: 'bg-info-tint text-info-text border-info/20',
  success: 'bg-success-tint text-success-text border-success/20',
  warning: 'bg-warning-tint text-warning-text border-warning/30',
  money: 'bg-money/10 text-money border-money/20',
};

export function Banner({
  accent = 'info', children, right, className,
}: { accent?: Accent; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm', BANNER[accent], className)}>
      <div className="min-w-0 flex-1">{children}</div>
      {right ? <div className="shrink-0 font-semibold tabular-nums">{right}</div> : null}
    </div>
  );
}

/* ─── proportion bar ───────────────────────────────────────────────────────
 * "Pending with EasyFix vs with you" — two shares of one whole, with a legend
 * that names both. A stacked bar without a legend is a decoration.
 */
export function ProportionBar({
  segments, className,
}: {
  segments: ReadonlyArray<{ label: string; value: number; accent: Accent }>;
  className?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  // BAR_FILL, not a local copy — this map had drifted into three places, and
  // two of them painting the same accent a different colour is the kind of bug
  // nobody reports because each screen looks fine on its own.
  const fill = BAR_FILL;
  return (
    <div className={className}>
      <div className="flex h-2 rounded-full overflow-hidden bg-ink-100">
        {segments.map((s) => (
          <div key={s.label} className={fill[s.accent]} style={{ width: `${(s.value / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-xs text-ink-500">
            <span className={cn('w-2 h-2 rounded-full', fill[s.accent])} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── ranked list ──────────────────────────────────────────────────────────
 * "Age of open jobs": a label and a figure per row, the figure carrying the
 * severity colour. Not a table — there is one value per row and no header.
 */
export function RankedList({
  rows, className,
}: {
  rows: ReadonlyArray<{
    label: ReactNode;
    value: ReactNode;
    accent?: Accent;
    onClick?: () => void;
    /** 0–1. Omit for a row whose value is not a share of anything. */
    bar?: number;
  }>;
  className?: string;
}) {
  return (
    <div className={className}>
      {rows.map((r, i) => {
        const Tag = r.onClick ? 'button' : 'div';
        return (
          <Tag
            key={i}
            type={r.onClick ? 'button' : undefined}
            onClick={r.onClick}
            className={cn(
              'w-full block py-2 border-b border-ink-100 last:border-0 text-left',
              r.onClick && 'hover:bg-surface-alt -mx-2 px-2 rounded transition',
            )}
          >
            {/* The bar sits UNDER the row, not beside it: a bar competing with
                the label for horizontal space truncates the one piece of text
                that identifies which row you are reading. */}
            <span className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-700 min-w-0 truncate">{r.label}</span>
              <span className={cn('text-sm font-semibold tabular-nums shrink-0', ACCENT_TEXT[r.accent ?? 'info'])}>
                {r.value}
              </span>
            </span>
            {typeof r.bar === 'number' ? <Bar value={r.bar} accent={r.accent ?? 'info'} /> : null}
          </Tag>
        );
      })}
    </div>
  );
}

/* ─── split layout ─────────────────────────────────────────────────────────
 * List on the left, detail on the right — the shape of Open jobs and
 * Completed. On narrow viewports the detail moves BELOW the list rather than
 * becoming a modal, so the selection stays visible and the back-and-forth of
 * "which one was I looking at?" never happens.
 */
export function SplitLayout({
  list, detail, className,
}: { list: ReactNode; detail: ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-4 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] items-stretch', className)}>
      {/*
        `[&>*]:flex-1` makes whatever is passed in fill its column, so the list
        and the detail pane align top AND bottom without either component
        hard-coding a height it cannot know the context for.
      */}
      <div className="min-w-0 flex flex-col [&>*]:flex-1">{list}</div>
      <div className="min-w-0 flex flex-col [&>*]:flex-1">{detail}</div>
    </div>
  );
}

/* ─── detail pane ──────────────────────────────────────────────────────────
 * The right-hand pane. `eyebrow` is the job id and city, `title` the store,
 * `sub` the work — the same three lines on every screen that has one.
 */
export function DetailPane({
  eyebrow, title, sub, onClose, children, className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  onClose?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <aside className={cn('bg-surface rounded-xl border border-ink-100 flex flex-col min-w-0', className)}>
      <div className="px-4 py-3 border-b border-ink-100 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {eyebrow ? <div className="text-xs text-ink-500 truncate">{eyebrow}</div> : null}
          <div className="text-sm font-semibold text-ink-900 truncate">{title}</div>
          {sub ? <div className="text-xs text-ink-500 truncate">{sub}</div> : null}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="shrink-0 p-1 rounded text-ink-300 hover:text-ink-700 hover:bg-surface-alt transition"
          >
            ✕
          </button>
        ) : null}
      </div>
      <div className="px-4 py-3 space-y-3 flex-1">{children}</div>
    </aside>
  );
}

/** A label/value line inside a detail pane. */
export function MetaRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-ink-100 last:border-0">
      <span className="text-xs text-ink-500 shrink-0">{label}</span>
      <span className="text-sm text-ink-900 text-right min-w-0 truncate">{value}</span>
    </div>
  );
}

/* ─── data table ───────────────────────────────────────────────────────────
 * Wrapped in its own horizontal scroller so a wide table never makes the PAGE
 * scroll sideways. `edge` paints a severity rule on the row's left edge —
 * the colour a scanning eye catches before it reads a word.
 */
export function DataTable({
  columns, children, className,
}: {
  columns: ReadonlyArray<{ key: string; label: ReactNode; align?: 'left' | 'right' | 'center'; className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-ink-100 bg-surface', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-100">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'px-3 py-2.5 text-xs font-medium text-ink-500 whitespace-nowrap',
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                  c.className,
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const EDGE: Record<Accent, string> = {
  brand: 'border-l-primary', info: 'border-l-info', success: 'border-l-success',
  warning: 'border-l-warning', money: 'border-l-money',
};

export function Row({
  edge, selected, onClick, children, className,
}: {
  edge?: Accent;
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr
      onClick={onClick}
      aria-selected={selected}
      className={cn(
        'border-b border-ink-100 last:border-0 border-l-4 transition',
        edge ? EDGE[edge] : 'border-l-transparent',
        selected ? 'bg-info-tint' : onClick && 'hover:bg-surface-alt cursor-pointer',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function Cell({
  children, align = 'left', className,
}: { children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string }) {
  return (
    <td
      className={cn(
        'px-3 py-2.5 align-top',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
    >
      {children}
    </td>
  );
}

/* ─── empty state ──────────────────────────────────────────────────────────
 * Says what is missing and, where possible, what to do about it. A bare
 * "No data" makes a working screen look broken.
 */
export function EmptyState({
  icon: Icon, title, sub, action,
}: { icon?: LucideIcon; title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="py-10 text-center">
      {Icon ? <Icon className="w-7 h-7 mx-auto text-ink-300" aria-hidden /> : null}
      <div className="mt-2 text-sm font-medium text-ink-700">{title}</div>
      {sub ? <div className="mt-0.5 text-xs text-ink-500">{sub}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/* ─── buttons ──────────────────────────────────────────────────────────────
 * The console's actions are overwhelmingly OUTLINED (Approve, Confirm access,
 * Raise PO, Review sit side by side in one queue). A column of solid red
 * buttons would make every row shout equally; the outline keeps the row legible
 * and reserves the solid treatment for the one primary action on a screen.
 */
export function ActionButton({
  children, onClick, variant = 'outline', size = 'sm', disabled, className, type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'outline' | 'primary' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition whitespace-nowrap disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        variant === 'primary' && 'bg-primary text-white hover:bg-primary-600',
        variant === 'outline' && 'border border-ink-100 bg-surface text-ink-900 hover:border-ink-300 hover:bg-surface-alt',
        variant === 'ghost' && 'text-info hover:text-info-text',
        className,
      )}
    >
      {children}
    </button>
  );
}
