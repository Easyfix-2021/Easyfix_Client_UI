'use client';

/*
 * Shared chrome for the Client Profile sections: the section header band, the
 * label/value row, the empty state, and the "this lives on its own page" link.
 *
 * WHY A LINK INSTEAD OF A SECOND IMPLEMENTATION. Four sections cover ground the
 * portal already has a full page for — Branches (/stores), Billing (/invoices),
 * Rate Cards (/ratecard), Reports (/performance, /export). Those sections show a
 * COMPACT summary and link out rather than re-rendering the page inside a
 * panel. Two implementations of one table is two places for a fix to land, and
 * the fuller page is always the better place to actually work.
 */

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

export function SectionShell({
  title, note, action, children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
          {note && <p className="text-sm text-ink-500 mt-0.5">{note}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** "Open the full page" affordance used by the summary-only sections. */
export function FullPageLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-dark"
    >
      {label} <ArrowUpRight className="w-4 h-4" />
    </Link>
  );
}

/** A read-only fact. `value` of null renders an em dash, never a blank cell. */
export function Fact({
  label, value, hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="rounded-xl border border-ink-100 bg-surface px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">{label}</div>
      <div className="text-sm text-ink-900 mt-1 break-words">
        {empty ? <span className="text-ink-300">—</span> : value}
      </div>
      {hint && <p className="text-xs text-ink-500 mt-1">{hint}</p>}
    </div>
  );
}

export function FactGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>;
}

/** Loading / error / empty, in the portal's voice. */
export function Panel({
  loading, error, empty, emptyText, children,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyText?: string;
  children: React.ReactNode;
}) {
  if (loading) return <p className="text-sm text-ink-500">Loading…</p>;
  if (error) {
    return (
      <p className="text-sm text-danger-text bg-danger-tint border border-danger/30 rounded-lg px-3 py-2">
        {error}
      </p>
    );
  }
  if (empty) return <p className="text-sm text-ink-500 italic">{emptyText ?? 'Nothing to show yet.'}</p>;
  return <>{children}</>;
}

/** Small status pill. Matches the profile page's Pill, without its icon slot. */
export function Chip({
  tone = 'neutral', children, title,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  children: React.ReactNode;
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-ink-50 text-ink-700 ring-ink-100',
    success: 'bg-success-tint text-success-text ring-success/30',
    warning: 'bg-warning-tint text-warning-text ring-warning/30',
    danger:  'bg-danger-tint text-danger-text ring-danger/30',
    info:    'bg-info-tint text-info-text ring-info/30',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/*
 * The banner every read-only section carries. A client portal that shows an
 * editable-looking field it cannot save is worse than one that says plainly
 * who owns the setting — so the sections that mirror EasyFix's commercial
 * config say it once, at the top, rather than disabling twelve inputs.
 */
export function ManagedByEasyFix({ what }: { what: string }) {
  return (
    <p className="text-xs text-info-text bg-info-tint border-l-2 border-info rounded-r px-3 py-2">
      {what} is set by EasyFix under your agreement, so it is read-only here.
      Ask your EasyFix SPOC to change it.
    </p>
  );
}
