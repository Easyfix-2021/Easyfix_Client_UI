'use client';

/*
 * The twelve Client Profile sections that are not Overview.
 *
 * They live in ONE file on purpose: each is a thin, read-mostly view over a
 * single existing endpoint, and twelve files of forty lines would be twelve
 * places to look for a change that is really one change. Overview and the
 * document checklist are separate because they are the only two that own a
 * form and a write path.
 *
 * ─── THE SUMMARISE-AND-LINK RULE ────────────────────────────────────────────
 * Four of these cover ground the portal already has a full page for —
 * Branches (/stores), Billing (/invoices), Rate Cards (/ratecard) and Reports
 * (/performance, /history, /export). Those sections show a COMPACT summary
 * and link out instead of re-rendering the page inside a panel. Two
 * implementations of one table is two places for a fix to land, and the fuller
 * page is always the better place to actually work.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Building2, Download, FileText, Globe,
  Mail, MapPin, Phone, ReceiptText, Settings2, ShieldCheck, Smartphone, Upload, Users,
} from 'lucide-react';
import { useFetchOnce } from '@/lib/hooks';
import { useAccess, useHasGrant } from '@/lib/spoc-context';
import {
  Chip, Fact, FactGrid, FullPageLink, ManagedByEasyFix, Panel, SectionShell,
} from './shell';
import {
  inr, localIsoDate,
  type Company, type InvoicesResponse, type PerformanceSlice, type Store, type TeamMember,
} from './types';

/* ═══ Roles & Actions ══════════════════════════════════════════════════════ */

/*
 * What YOU can do here, and what your colleagues can. Both halves are real:
 * the top is `access` from /me (the server's own resolution, not a guess), the
 * bottom is the team list with the one per-person flag the portal exposes —
 * approval_by_client, which decides who may approve an estimate.
 *
 * Role ASSIGNMENT is not here because the portal cannot do it: roles are set
 * from the EasyFix CRM. Showing a picker that has no writer would be worse
 * than saying so.
 */
const SURFACE_LABELS: Record<string, string> = {
  home: 'Home',
  open: 'Open Jobs',
  completed: 'Completed Jobs',
  performance: 'Performance',
  actions: 'Approve Estimates',
  invoicing: 'Invoicing',
};

export function RolesActionsSection() {
  const access = useAccess();
  const { data, loading, error } = useFetchOnce<{ items: TeamMember[] }>('/team');
  const team = (data?.items ?? []).filter((m) => m.status === 1);
  const approvers = team.filter((m) => Number(m.approvalByClient) === 1);

  return (
    <SectionShell
      title="Roles & Actions"
      note="What your account can do, and who else at your company can do it."
    >
      <div className="rounded-xl border border-ink-100 bg-surface px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-ink-900">Your Role</span>
          <Chip tone={access.unassigned ? 'danger' : 'info'}>{access.roleName}</Chip>
          {access.allStores
            ? <Chip tone="success">All Branches</Chip>
            : <Chip tone="neutral">Your Branches Only</Chip>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {access.grants.map((g) => (
            <Chip key={g} tone="neutral">{SURFACE_LABELS[g] ?? g}</Chip>
          ))}
        </div>
        {access.unassigned && (
          <p className="text-xs text-danger-text">
            No role has been set for you yet. Ask your EasyFix SPOC to assign one.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-900">Who Can Approve Estimates</h3>
        <Panel loading={loading} error={error} empty={team.length === 0}
          emptyText="No active contacts on your account.">
          {approvers.length === 0 ? (
            <p className="text-sm text-warning-text bg-warning-tint border border-warning/30 rounded-lg px-3 py-2">
              Nobody at your company is set as an estimate approver, so every estimate
              waits for EasyFix to chase someone. Ask your EasyFix SPOC to set one.
            </p>
          ) : (
            <ul className="space-y-1">
              {approvers.map((m) => (
                <li key={m.id} className="rounded-lg border border-ink-100 bg-surface px-3 py-2 text-sm flex items-center justify-between gap-2 flex-wrap">
                  <span>
                    <span className="font-semibold text-ink-900">{m.name || 'Unnamed'}</span>
                    {m.designation && <span className="text-ink-500"> · {m.designation}</span>}
                  </span>
                  <span className="text-xs text-ink-500">{m.email}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-500 mt-2">
            {team.length} active contact{team.length === 1 ? '' : 's'} in total —
            see them all under Contacts.
          </p>
        </Panel>
      </div>
    </SectionShell>
  );
}

/* ═══ Contacts ═════════════════════════════════════════════════════════════ */

export function ContactsSection() {
  const { data, loading, error } = useFetchOnce<{ items: TeamMember[] }>('/team');
  const items = data?.items ?? [];
  const active = items.filter((m) => m.status === 1);

  return (
    <SectionShell
      title="Contacts"
      note="Everyone at your company who works with EasyFix."
      action={<FullPageLink href="/team" label="Open Team" />}
    >
      <Panel loading={loading} error={error} empty={items.length === 0}
        emptyText="No contacts on your account yet.">
        <div className="overflow-x-auto rounded-xl border border-ink-100">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-700">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Name</th>
                <th className="text-left font-semibold px-3 py-2">Email</th>
                <th className="text-left font-semibold px-3 py-2">Mobile</th>
                <th className="text-center font-semibold px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {items.map((m) => (
                <tr key={m.id} className="bg-surface">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink-900">{m.name || 'Unnamed'}</div>
                    {m.designation && <div className="text-xs text-ink-500">{m.designation}</div>}
                  </td>
                  <td className="px-3 py-2 text-ink-700 break-all">{m.email || '—'}</td>
                  <td className="px-3 py-2 text-ink-700">{m.mobile || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <Chip tone={m.status === 1 ? 'success' : 'neutral'}>
                      {m.status === 1 ? 'Active' : 'Inactive'}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-500 mt-2">
          {active.length} active of {items.length}. Contacts are added and removed by
          EasyFix — ask your SPOC.
        </p>
      </Panel>
    </SectionShell>
  );
}

/* ═══ Branches ═════════════════════════════════════════════════════════════ */

export function BranchesSection() {
  const { data, loading, error } = useFetchOnce<{ items: Store[] }>('/stores');
  const items = data?.items ?? [];
  const preview = items.slice(0, 8);

  return (
    <SectionShell
      title="Branches"
      note="The sites you book work against. Used by the store-code picker on a new order."
      action={<FullPageLink href="/stores" label="Open Branches" />}
    >
      <Panel loading={loading} error={error} empty={items.length === 0}
        emptyText="No branches are loaded for your account yet.">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {preview.map((s) => (
            <li key={s.id} className="rounded-xl border border-ink-100 bg-surface px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="font-semibold text-ink-900 text-sm">{s.store_name || 'Unnamed branch'}</span>
                {s.store_code && <Chip tone="neutral">{s.store_code}</Chip>}
              </div>
              <div className="text-xs text-ink-500 mt-1">
                {[s.address, s.city_name, s.pin_code].filter(Boolean).join(', ') || 'No address on file'}
              </div>
              {s.contact_name && (
                <div className="text-xs text-ink-500 mt-0.5">
                  Site contact: {s.contact_name}{s.contact_no ? ` · ${s.contact_no}` : ''}
                </div>
              )}
            </li>
          ))}
        </ul>
        {items.length > preview.length && (
          <p className="text-xs text-ink-500 mt-2">
            Showing {preview.length} of {items.length}. Open Branches for the full directory.
          </p>
        )}
      </Panel>
    </SectionShell>
  );
}

/* ═══ Booking Channels ═════════════════════════════════════════════════════ */

/*
 * Every route an order can reach EasyFix through, with its real state. The
 * public link is derived from your reference code because that is literally
 * what the public route resolves a client BY — no code, no public page.
 */
export function BookingChannelsSection({ company }: { company: Company }) {
  const publicUrl = useMemo(() => {
    const code = String(company.referenceCode ?? '').trim();
    if (!code || typeof window === 'undefined') return null;
    return `${window.location.origin}/public/book/${encodeURIComponent(code)}`;
  }, [company.referenceCode]);

  return (
    <SectionShell
      title="Booking Channels"
      note="Every way an order can reach EasyFix from your side."
    >
      <ul className="space-y-2">
        <Channel
          icon={Globe} name="This Portal" on
          detail="Raise and track orders yourself, with your team's own logins."
          action={<Link href="/jobs/new" className="text-sm font-semibold text-primary hover:text-primary-dark">New Order</Link>}
        />
        <Channel
          icon={Upload} name="Bulk Upload" on
          detail="Raise many orders at once from a spreadsheet."
          action={<Link href="/jobs/upload" className="text-sm font-semibold text-primary hover:text-primary-dark">Upload</Link>}
        />
        <Channel
          icon={Building2} name="Public Booking Link" on={!!publicUrl}
          detail={publicUrl
            ? 'Anyone with this link or its QR code can raise an order against your account.'
            : 'Your account has no reference code, so there is no public booking page. Ask your EasyFix SPOC.'}
        >
          {publicUrl && <code className="block text-xs mt-1 break-all text-ink-500">{publicUrl}</code>}
        </Channel>
        <Channel
          icon={Smartphone} name="Mobile App" on
          detail="The same portal on your phone, for raising orders from site."
        />
        <Channel
          icon={Mail} name="Your EasyFix SPOC" on
          detail="Email or call your account manager — see Overview for who that is."
        />
      </ul>
    </SectionShell>
  );
}

function Channel({
  icon: Icon, name, on, detail, action, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  on: boolean;
  detail: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="rounded-xl border border-ink-100 bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className="w-4 h-4 text-primary shrink-0" />
            <span className="font-semibold text-sm text-ink-900">{name}</span>
            <Chip tone={on ? 'success' : 'neutral'}>{on ? 'Available' : 'Not Set Up'}</Chip>
          </div>
          <p className="text-xs text-ink-500 mt-1">{detail}</p>
          {children}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </li>
  );
}

/* ═══ Billing & Estimates ══════════════════════════════════════════════════ */

export function BillingSection() {
  const canSee = useHasGrant('invoicing');
  const { data, loading, error } = useFetchOnce<InvoicesResponse>(canSee ? '/invoices' : null);

  if (!canSee) {
    return (
      <SectionShell title="Billing & Estimates" note="Invoices raised against your account.">
        <NoGrant what="invoices" />
      </SectionShell>
    );
  }

  const s = data?.summary;
  const aging = data?.aging;

  return (
    <SectionShell
      title="Billing & Estimates"
      note="Invoices raised against your account, and what is still open."
      action={<FullPageLink href="/invoices" label="Open Invoicing" />}
    >
      <Panel loading={loading} error={error} empty={!s || s.count === 0}
        emptyText="No invoices have been raised yet.">
        <FactGrid>
          <Fact label="Billed" value={s ? `₹${inr.format(s.billed)}` : null} />
          <Fact label="Collected" value={s ? `₹${inr.format(s.collected)}` : null} />
          <Fact label="Outstanding" value={s ? `₹${inr.format(s.outstanding)}` : null} />
        </FactGrid>
        {aging && aging.unpaid > 0 && (
          <div className="mt-3">
            <h3 className="text-sm font-semibold text-ink-900 mb-2">What Is Overdue</h3>
            <FactGrid>
              <Fact label="0–30 Days" value={`₹${inr.format(aging.a0_30)}`} />
              <Fact label="31–60 Days" value={`₹${inr.format(aging.a31_60)}`} />
              <Fact label="60+ Days" value={`₹${inr.format(aging.a60plus)}`} />
            </FactGrid>
          </div>
        )}
        <p className="text-xs text-ink-500 mt-2">
          Estimates waiting on your approval are in
          {' '}<Link href="/action-queue" className="text-primary font-semibold hover:text-primary-dark">My Action Queue</Link>.
        </p>
      </Panel>
    </SectionShell>
  );
}

/* ═══ Account & Payment ════════════════════════════════════════════════════ */

export function AccountPaymentSection({ company }: { company: Company }) {
  const canSeeInvoices = useHasGrant('invoicing');
  const { data } = useFetchOnce<InvoicesResponse>(canSeeInvoices ? '/invoices' : null);
  const inv = company.terms.invoicing;

  return (
    <SectionShell
      title="Account & Payment"
      note="How your account is invoiced and settled."
    >
      <ManagedByEasyFix what="Your payment arrangement" />
      <FactGrid>
        <Fact
          label="Arrangement"
          value={inv.raised ? 'Invoiced On A Cycle' : 'Settled Per Job'}
          hint={inv.raised
            ? 'Work is billed together on the cycle below.'
            : 'Each job is settled at the job; no invoice cycle runs.'}
        />
        <Fact label="Invoice Name" value={company.billingName} />
        <Fact
          label="Invoice Cycle"
          value={inv.cycle ? formatCycle(inv.cycle) : null}
          hint={inv.cycle ? undefined : 'Not set.'}
        />
        <Fact label="Invoicing Since" value={inv.startDate ? inv.startDate.slice(0, 10) : null} />
        <Fact label="Paid By" value={company.terms.paidBy?.label ?? null} />
        <Fact label="Collected By" value={company.terms.collectedBy?.label ?? null} />
      </FactGrid>
      {canSeeInvoices && data?.summary && (
        <div className="rounded-xl border border-ink-100 bg-surface px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Currently Outstanding</div>
            <div className="text-xl font-semibold text-money mt-0.5">₹{inr.format(data.summary.outstanding)}</div>
          </div>
          <FullPageLink href="/invoices" label="See Invoices" />
        </div>
      )}
    </SectionShell>
  );
}

/*
 * The cycle is stored as a CSV of days of the month, with 40 meaning "last day"
 * — a legacy sentinel, not a 40th. Rendering the raw string would show "1,40".
 */
function formatCycle(csv: string): string {
  const parts = csv.split(',').map((x) => x.trim()).filter(Boolean);
  const ordinal = (n: number) => {
    if (n === 40) return 'last day of the month';
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  };
  return parts.map((p) => ordinal(Number(p))).join(' and ');
}

/* ═══ Services ═════════════════════════════════════════════════════════════ */

export function ServicesSection() {
  const { data, loading, error } = useFetchOnce<{ items: Array<{ id: number; name: string | null }> }>(
    '/lookup/service-categories',
  );
  const items = data?.items ?? [];

  return (
    <SectionShell
      title="Services"
      note="The work EasyFix is contracted to do for you."
      action={<FullPageLink href="/ratecard" label="See Rates" />}
    >
      <ManagedByEasyFix what="Your contracted service list" />
      <Panel loading={loading} error={error} empty={items.length === 0}
        emptyText="No services are contracted on your account yet.">
        <ul className="flex flex-wrap gap-2">
          {items.map((c) => (
            <li key={c.id}>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full bg-primary-50 text-primary ring-1 ring-primary/20">
                <Settings2 className="w-3.5 h-3.5" /> {c.name || `Category #${c.id}`}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-500 mt-2">
          {items.length} service categor{items.length === 1 ? 'y' : 'ies'}. These are the
          categories you can pick on a new order.
        </p>
      </Panel>
    </SectionShell>
  );
}

/* ═══ Rate Cards ═══════════════════════════════════════════════════════════ */

type RateRow = {
  client_service_id: number;
  service_category_name: string | null;
  service_type_name: string | null;
  rate_card_name: string | null;
  total_amount: number | null;
};

export function RateCardsSection() {
  const { data, loading, error } = useFetchOnce<{ items: RateRow[] }>('/ratecard');
  const items = data?.items ?? [];

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of items) {
      const key = r.service_category_name || 'Other';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  return (
    <SectionShell
      title="Rate Cards"
      note="The agreed rate for each service on your account."
      action={<FullPageLink href="/ratecard" label="Open Rate Card" />}
    >
      <ManagedByEasyFix what="Your rates" />
      <Panel loading={loading} error={error} empty={items.length === 0}
        emptyText="No rates are published on your account yet.">
        <FactGrid>
          <Fact label="Priced Services" value={inr.format(items.length)} />
          <Fact label="Categories" value={inr.format(byCategory.length)} />
        </FactGrid>
        <ul className="space-y-1 mt-3">
          {byCategory.map(([name, count]) => (
            <li key={name} className="rounded-lg border border-ink-100 bg-surface px-3 py-2 text-sm flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-ink-900">
                <ReceiptText className="w-3.5 h-3.5 text-ink-500" /> {name}
              </span>
              <span className="text-xs text-ink-500">{count} priced</span>
            </li>
          ))}
        </ul>
      </Panel>
    </SectionShell>
  );
}

/* ═══ SLA & Priorities ═════════════════════════════════════════════════════ */

/*
 * `targets.source` is the most important field on this screen. Most accounts
 * have no contracted row, in which case the platform defaults are shown — and
 * showing a default as if it were a commitment is exactly the sentence nobody
 * wants read back to them in a review. The banner says which it is, every time.
 */
export function SlaSection() {
  const canSee = useHasGrant('performance');
  const { from, to } = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    return { from: localIsoDate(start), to: localIsoDate(now) };
  }, []);
  const { data, loading, error } = useFetchOnce<PerformanceSlice>(
    canSee ? `/performance?from=${from}&to=${to}` : null,
  );

  if (!canSee) {
    return (
      <SectionShell title="SLA & Priorities" note="The targets your account is measured against.">
        <NoGrant what="performance" />
      </SectionShell>
    );
  }

  const t = data?.targets;
  const contracted = t?.source === 'contracted';

  return (
    <SectionShell
      title="SLA & Priorities"
      note="The targets your account is measured against."
      action={<FullPageLink href="/performance" label="Open Performance" />}
    >
      <Panel loading={loading} error={error} empty={!t} emptyText="No targets available.">
        <p className={`text-xs rounded-lg px-3 py-2 border ${contracted
          ? 'bg-success-tint text-success-text border-success/30'
          : 'bg-warning-tint text-warning-text border-warning/30'}`}
        >
          {contracted
            ? 'These are the targets contracted for your account.'
            : 'No account-specific targets are configured, so the EasyFix platform standards are shown. They are what EasyFix holds itself to rather than a commitment made to you — ask your SPOC to have yours set.'}
        </p>
        {t && (
          <FactGrid>
            <Fact label="SLA Met" value={`${t.sla_pct}%`} hint="Jobs meeting every EasyFix-owned stage." />
            <Fact label="First-Time Fix" value={`${t.ftfr_pct}%`} hint="Closed on the first visit." />
            <Fact label="Revisit Rate" value={`${t.revisit_pct}%`} hint="Lower is better." />
            <Fact label="Age At Close" value={`${t.avg_age_days} days`} hint="Lower is better." />
            <Fact label="Your Approval Response" value={`${t.approval_response_hours} hrs`}
              hint="Your clock — how quickly estimates are approved." />
          </FactGrid>
        )}
        {data?.tat && (
          <p className="text-xs text-ink-500">
            Last 30 days: {inr.format(data.tat.jobsAnalysed)} job{data.tat.jobsAnalysed === 1 ? '' : 's'} measured
            {data.tat.efScorePct != null && <>, {data.tat.efScorePct}% of stages met</>}.
          </p>
        )}
      </Panel>
    </SectionShell>
  );
}

/* ═══ Notifications ════════════════════════════════════════════════════════ */

/*
 * WHO gets contacted, not a preferences form — the platform has no per-client
 * notification settings table, and a toggle with no writer behind it is worse
 * than an honest read-only list. What IS real: the contacts we hold channels
 * for, and the ones we do not.
 */
export function NotificationsSection() {
  const { data, loading, error } = useFetchOnce<{ items: TeamMember[] }>('/team');
  const active = (data?.items ?? []).filter((m) => m.status === 1);
  const noEmail = active.filter((m) => !String(m.email ?? '').trim());
  const noMobile = active.filter((m) => !String(m.mobile ?? '').trim());

  return (
    <SectionShell
      title="Notifications"
      note="Who EasyFix contacts about your orders."
      action={<FullPageLink href="/notifications" label="Open Notifications" />}
    >
      <Panel loading={loading} error={error} empty={active.length === 0}
        emptyText="No active contacts on your account.">
        {noEmail.length > 0 && (
          <p className="text-xs text-warning-text bg-warning-tint border border-warning/30 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            {noEmail.length} active contact{noEmail.length === 1 ? ' has' : 's have'} no email
            address on file, so no email notification can reach them.
          </p>
        )}
        <ul className="space-y-1">
          {active.map((m) => (
            <li key={m.id} className="rounded-lg border border-ink-100 bg-surface px-3 py-2 text-sm flex items-center justify-between gap-2 flex-wrap">
              <span className="font-semibold text-ink-900">{m.name || 'Unnamed'}</span>
              <span className="flex items-center gap-3 text-xs">
                <span className={m.email ? 'text-ink-500' : 'text-warning-text font-semibold'}>
                  <Mail className="w-3 h-3 inline mr-1" />{m.email || 'No email'}
                </span>
                <span className={m.mobile ? 'text-ink-500' : 'text-ink-300'}>
                  <Phone className="w-3 h-3 inline mr-1" />{m.mobile || '—'}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-500 mt-2">
          {active.length - noEmail.length} of {active.length} reachable by email,
          {' '}{active.length - noMobile.length} by SMS. Contact details are corrected
          by EasyFix — ask your SPOC.
        </p>
      </Panel>
    </SectionShell>
  );
}

/* ═══ Reports ══════════════════════════════════════════════════════════════ */

export function ReportsSection() {
  const hasPerformance = useHasGrant('performance');
  const links: Array<{ href: string; label: string; note: string; icon: React.ComponentType<{ className?: string }>; gated?: boolean }> = [
    { href: '/performance', label: 'Performance', note: 'SLA, first-time fix and turnaround against your targets.', icon: ShieldCheck, gated: !hasPerformance },
    { href: '/history',     label: 'Order History', note: 'Every order raised on your account.', icon: FileText },
    { href: '/export',      label: 'Export',      note: 'Download your orders as a spreadsheet.', icon: Download },
  ];

  return (
    <SectionShell title="Reports" note="Where to look at your numbers.">
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {links.map((l) => (
          <li key={l.href} className="rounded-xl border border-ink-100 bg-surface px-4 py-3">
            {l.gated ? (
              <>
                <span className="font-semibold text-sm text-ink-300 inline-flex items-center gap-1.5">
                  <l.icon className="w-4 h-4" /> {l.label}
                </span>
                <p className="text-xs text-ink-500 mt-0.5">
                  Your role does not include this report. Ask your EasyFix SPOC.
                </p>
              </>
            ) : (
              <>
                <Link href={l.href} className="font-semibold text-sm text-primary hover:text-primary-dark inline-flex items-center gap-1.5">
                  <l.icon className="w-4 h-4" /> {l.label}
                </Link>
                <p className="text-xs text-ink-500 mt-0.5">{l.note}</p>
              </>
            )}
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

/* ═══ Custom Properties ════════════════════════════════════════════════════ */

/*
 * The extra fields your account adds to a booking form. The endpoint already
 * filters out backend switches (is_config) and soft-deleted rows, so what
 * arrives here is exactly what a person is asked to fill in on a new order.
 */
export function CustomPropertiesSection() {
  const { data, loading, error } = useFetchOnce<{ items: Array<{ name: string; label: string; mandatory: boolean }> }>(
    '/me/custom-properties',
  );
  const items = data?.items ?? [];

  return (
    <SectionShell
      title="Custom Properties"
      note="The extra details your account collects on every order."
    >
      <ManagedByEasyFix what="This field list" />
      <Panel loading={loading} error={error} empty={items.length === 0}
        emptyText="Your account adds no extra booking fields.">
        <ul className="space-y-1">
          {items.map((p) => (
            <li key={p.name} className="rounded-lg border border-ink-100 bg-surface px-3 py-2 text-sm flex items-center justify-between gap-2">
              <span className="text-ink-900">{p.label || p.name}</span>
              <Chip tone={p.mandatory ? 'warning' : 'neutral'}>
                {p.mandatory ? 'Required' : 'Optional'}
              </Chip>
            </li>
          ))}
        </ul>
      </Panel>
    </SectionShell>
  );
}

/* ═══ Shared: the "your role does not include this" panel ══════════════════ */

function NoGrant({ what }: { what: string }) {
  return (
    <p className="text-sm text-ink-500 bg-ink-50 border border-ink-100 rounded-lg px-3 py-2 inline-flex items-start gap-2">
      <Users className="w-4 h-4 shrink-0 mt-0.5" />
      Your role does not include {what}. A Senior Leader or Finance contact at your
      company can see this — or ask your EasyFix SPOC to widen your access.
    </p>
  );
}
