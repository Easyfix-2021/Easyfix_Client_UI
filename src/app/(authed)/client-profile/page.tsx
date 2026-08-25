'use client';

/*
 * Client Profile — /client-profile
 *
 * Your COMPANY as EasyFix holds it: the master record, your documents, your
 * branches, your rates, your targets and who we contact. Distinct from
 * /profile, which is YOUR OWN contact record (name, designation, login mobile
 * and email) and is deliberately left alone — one page answers "who am I", this
 * one answers "who are we, and what have we agreed".
 *
 * ─── LAYOUT ─────────────────────────────────────────────────────────────────
 *   ┌ Client Profile ...................................... [actions] ┐
 *   ┌ hero: monogram · name · status · terms · four figures           ┐
 *   ┌ context strip: brand + contracted service categories            ┐
 *   ┌ rail (13) ┬ section body ─────────────────────────────────────  ┐
 *
 * ─── TWO DELIBERATE DEPARTURES FROM THE DESIGN COMP ─────────────────────────
 *   1. The comp's "⋯ Actions" kebab is an inline action row here. On a CRM the
 *      menu holds destructive operations worth hiding; the two useful actions
 *      for a client — raise an order, reach your SPOC — are worth one click,
 *      not two, and the portal has no dropdown primitive to build them on.
 *   2. The comp's project selector ("Brightline Retail (Brand) ▾ — Project: …")
 *      is a read-only strip. The portal has no per-project scoping: one account
 *      carries one set of settings. A selector that changed the label and
 *      nothing else would be a control that lies, so the strip shows the brand
 *      plus the service categories actually contracted — the real answer to
 *      "what do we buy from EasyFix".
 *
 * Every write on this page is gated SERVER-SIDE (GET /company returns
 * `canEdit`, and the PUT re-checks). Hiding an input is a courtesy; the server
 * is the boundary.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Building2, ClipboardCheck, FolderOpen, IndianRupee, LifeBuoy, Plus, Timer,
} from 'lucide-react';
import { useFetchOnce } from '@/lib/hooks';
import { useSpoc, useHasGrant } from '@/lib/spoc-context';
import { cn } from '@/lib/utils';
import { Chip } from '@/components/client-profile/shell';
import { OverviewSection } from '@/components/client-profile/OverviewSection';
import {
  AccountPaymentSection, BillingSection, BookingChannelsSection, BranchesSection,
  ContactsSection, CustomPropertiesSection, NotificationsSection, RateCardsSection,
  ReportsSection, RolesActionsSection, ServicesSection, SlaSection,
} from '@/components/client-profile/sections';
import {
  PROFILE_TABS, inr, localIsoDate, resolveProfileTab,
  type Company, type InvoicesResponse, type PerformanceSlice, type ProfileTab,
} from '@/components/client-profile/types';

/* Two-letter monogram, same rule as the /profile hero avatar. */
function initialsOf(name?: string | null) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ClientProfilePage() {
  const spoc = useSpoc();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canSeeInvoices = useHasGrant('invoicing');
  const canSeePerformance = useHasGrant('performance');

  /* The active section is URL state so a link into a section survives a
     refresh and the Back button walks out of the page, not through it. */
  const tab = resolveProfileTab(searchParams.get('tab'));

  function selectTab(next: ProfileTab) {
    const qs = new URLSearchParams(searchParams.toString());
    if (next === 'overview') qs.delete('tab');
    else qs.set('tab', next);
    const q = qs.toString();
    router.replace(q ? `/client-profile?${q}` : '/client-profile', { scroll: false });
  }

  const { data: company, loading, error, reload } = useFetchOnce<Company>('/company');

  /* ── The four headline figures ──────────────────────────────────── */
  const { data: invoices } = useFetchOnce<InvoicesResponse>(canSeeInvoices ? '/invoices' : null);
  const { data: dash } = useFetchOnce<{ newTickets: number; inProgress: number; completed: number }>('/dashboard');
  // limit=100 rather than the default 25 so the count is not quietly capped at
  // a number that looks like a real total. It CAN still cap — see the tile.
  const { data: queue } = useFetchOnce<{ items: unknown[]; total: number }>('/action-queue?limit=100');

  const perfWindow = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    return { from: localIsoDate(start), to: localIsoDate(now) };
  }, []);
  const { data: perf } = useFetchOnce<PerformanceSlice>(
    canSeePerformance ? `/performance?from=${perfWindow.from}&to=${perfWindow.to}` : null,
  );

  /*
   * Jobs where at least one EasyFix-owned stage was missed. The engine labels a
   * job 'Excellent' only when every one of those stages was met, so anything
   * scored below that is a miss; 'Pending' jobs are excluded because they are
   * not judgeable yet, not because they passed.
   */
  const slaBreaches = useMemo(() => {
    if (!perf?.tat) return null;
    const l = perf.tat.labels;
    const judged = perf.tat.jobsAnalysed - (l.Pending ?? 0);
    return Math.max(0, judged - (l.Excellent ?? 0));
  }, [perf]);

  const { data: categories } = useFetchOnce<{ items: Array<{ id: number; name: string | null }> }>(
    '/lookup/service-categories',
  );

  const clientName = company?.clientName || spoc.client_name || 'Your Company';

  return (
    <div className="space-y-5">
      {/* ── Title + actions ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink-900 inline-flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" /> Client Profile
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href="/jobs/new"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-dark inline-flex items-center gap-1.5 shadow-md shadow-primary/30"
          >
            <Plus className="w-4 h-4" /> New Order
          </Link>
          <Link
            href="/tickets/new"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-ink-700 border border-ink-100 hover:bg-ink-50 inline-flex items-center gap-1.5"
          >
            <LifeBuoy className="w-4 h-4" /> Raise A Ticket
          </Link>
        </div>
      </div>

      {error && (
        <p className="text-sm text-danger-text bg-danger-tint border border-danger/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div className="relative bg-surface border border-ink-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary via-primary-dark to-primary" />
        <div className="p-6 space-y-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-16 h-16 shrink-0 rounded-2xl grid place-items-center text-xl font-semibold text-white shadow-md shadow-ink-900/20 bg-gradient-to-br from-primary via-primary-600 to-primary-dark">
              {initialsOf(clientName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-semibold text-ink-900 truncate">{clientName}</h2>
                {company && (
                  <Chip tone={company.status === 1 ? 'success' : 'danger'}>
                    {company.status === 1 ? 'Active' : 'Inactive'}
                  </Chip>
                )}
                {company && (
                  <Chip
                    tone={company.terms.invoicing.raised ? 'info' : 'neutral'}
                    title={company.terms.invoicing.raised
                      ? 'Work is invoiced together on a billing cycle'
                      : 'Each job is settled at the job'}
                  >
                    {company.terms.invoicing.raised ? 'Postpaid' : 'Pay Per Job'}
                  </Chip>
                )}
              </div>
              {company && <HeroSubline company={company} />}
            </div>
          </div>

          {/*
           * Each tile renders a dash rather than a zero when the number is
           * genuinely unavailable — "₹0 outstanding" and "your role cannot see
           * invoicing" are very different statements to put in front of someone.
           */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi
              icon={<IndianRupee className="w-3.5 h-3.5" />}
              label="Outstanding"
              value={!canSeeInvoices ? null : (invoices ? `₹${inr.format(invoices.summary.outstanding)}` : undefined)}
              hint={!canSeeInvoices
                ? 'Your role does not include invoicing'
                : (invoices ? `${inr.format(invoices.summary.count)} invoices raised` : undefined)}
            />
            <Kpi
              icon={<FolderOpen className="w-3.5 h-3.5" />}
              label="Open Orders"
              value={dash ? inr.format(dash.inProgress ?? 0) : undefined}
              hint={dash ? `${inr.format(dash.completed ?? 0)} completed to date` : undefined}
            />
            <Kpi
              icon={<ClipboardCheck className="w-3.5 h-3.5" />}
              label="Waiting On You"
              value={queue ? `${inr.format(queue.total)}${queue.total >= 100 ? '+' : ''}` : undefined}
              hint="Estimates needing your approval"
              tone={queue && queue.total > 0 ? 'warning' : undefined}
            />
            <Kpi
              icon={<Timer className="w-3.5 h-3.5" />}
              label="SLA Misses (30d)"
              value={!canSeePerformance ? null : (slaBreaches == null ? undefined : inr.format(slaBreaches))}
              hint={!canSeePerformance
                ? 'Your role does not include performance'
                : (perf ? `${inr.format(perf.tat.jobsAnalysed)} jobs measured` : undefined)}
              tone={slaBreaches ? 'danger' : undefined}
            />
          </div>
        </div>
      </div>

      {/* ── Context strip ───────────────────────────────────────── */}
      <div className="rounded-xl border border-ink-100 bg-ink-50 px-4 py-2.5 text-sm flex items-center gap-x-2 gap-y-1 flex-wrap">
        <span className="font-semibold text-ink-900">{clientName}</span>
        <span className="text-ink-500">(Brand)</span>
        {categories && categories.items.length > 0 ? (
          <>
            <span className="text-ink-300">·</span>
            <span className="text-ink-500">Services:</span>
            {categories.items.slice(0, 6).map((c) => (
              <Chip key={c.id} tone="neutral">{c.name || `#${c.id}`}</Chip>
            ))}
            {categories.items.length > 6 && (
              <span className="text-xs text-ink-500">+{categories.items.length - 6} more</span>
            )}
          </>
        ) : (
          <span className="text-ink-500">· No services contracted yet</span>
        )}
      </div>

      {/* ── Rail + body ─────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <nav
          aria-label="Client profile sections"
          className="w-full lg:w-56 shrink-0 bg-surface border border-ink-100 rounded-xl shadow-sm p-2 flex lg:flex-col gap-1 overflow-x-auto"
        >
          {PROFILE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={cn(
                'text-left text-sm rounded-lg px-3 py-2 whitespace-nowrap transition font-semibold',
                tab === t.key
                  ? 'bg-primary text-white shadow-sm shadow-primary/30'
                  : 'text-ink-700 hover:bg-ink-50',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0 w-full bg-surface border border-ink-100 rounded-xl shadow-sm p-6">
          {loading && <p className="text-sm text-ink-500">Loading…</p>}
          {!loading && company && (
            <Section tab={tab} company={company} onSaved={reload} />
          )}
          {!loading && !company && !error && (
            <p className="text-sm text-ink-500">We could not load your company profile.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* The three presentation names, shown only where they add something. */
function HeroSubline({ company }: { company: Company }) {
  const parts: string[] = [];
  if (company.billingName && company.billingName !== company.clientName) {
    parts.push(`Billing: ${company.billingName}`);
  }
  if (company.techAppName && company.techAppName !== company.clientName) {
    parts.push(`Tech app: ${company.techAppName}`);
  }
  if (company.referenceCode) parts.push(`Ref: ${company.referenceCode}`);
  if (parts.length === 0) return null;
  return <p className="text-xs text-ink-500 mt-1 truncate">{parts.join(' · ')}</p>;
}

function Kpi({
  icon, label, value, hint, tone,
}: {
  icon: React.ReactNode;
  label: string;
  /* undefined = still loading. null = genuinely unavailable (renders a dash). */
  value: string | null | undefined;
  hint?: string;
  tone?: 'warning' | 'danger';
}) {
  return (
    <div className="min-w-0">
      <div className={cn(
        'text-2xl font-semibold tabular-nums',
        tone === 'danger' && 'text-danger-text',
        tone === 'warning' && 'text-warning-text',
        !tone && 'text-ink-900',
      )}>
        {value === undefined ? <span className="text-base font-normal text-ink-300">…</span>
          : value === null ? <span className="text-ink-300">—</span>
            : value}
      </div>
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-500 inline-flex items-center gap-1 mt-0.5">
        {icon} {label}
      </div>
      {hint && <div className="text-xs text-ink-500 mt-0.5 truncate" title={hint}>{hint}</div>}
    </div>
  );
}

function Section({
  tab, company, onSaved,
}: {
  tab: ProfileTab;
  company: Company;
  onSaved: () => void;
}) {
  switch (tab) {
    case 'overview':      return <OverviewSection company={company} onSaved={onSaved} />;
    case 'roles':         return <RolesActionsSection />;
    case 'contacts':      return <ContactsSection />;
    case 'branches':      return <BranchesSection />;
    case 'channels':      return <BookingChannelsSection company={company} />;
    case 'billing':       return <BillingSection />;
    case 'account':       return <AccountPaymentSection company={company} />;
    case 'services':      return <ServicesSection />;
    case 'rate-cards':    return <RateCardsSection />;
    case 'sla':           return <SlaSection />;
    case 'notifications': return <NotificationsSection />;
    case 'reports':       return <ReportsSection />;
    case 'properties':    return <CustomPropertiesSection />;
    default:              return null;
  }
}
