'use client';

/**
 * Invoicing — where the client's money sits, and the paper behind it.
 *
 * Built to the design the client team shared, block for block: three summary
 * cards, then a warning-accented "pending your action" table, then the raised-
 * invoice register with an export. Every piece of chrome comes from
 * src/components/ui/console, so this file holds composition and arithmetic —
 * not styling. Amounts are drawn in the `money` token; the cards' left rules
 * carry the meaning (action / raised / settled).
 *
 * WHERE THE NUMBERS COME FROM, AND WHERE THEY DO NOT
 *
 * One endpoint: GET /api/client/invoices, which reads tbl_client_invoice for
 * the client (NOT team-scoped — invoices are raised against the client, not a
 * SPOC) and returns exactly three things:
 *
 *   summary  billed / collected / outstanding / count, over every RAISED
 *            invoice, all time.
 *   aging    the OUTSTANDING amount split 0–30 / 31–60 / 60+ days past the
 *            due date, plus the count of unpaid invoices.
 *   items    up to 300 invoices, newest first, each with its dates, total,
 *            paid, due, a payment status and a PDF path when one is on file.
 *
 * That is the whole surface. It carries no job dimension, no store, no line
 * items and no payment dates. The mock was drawn against a billing system that
 * has all four, so three of its figures have no honest source here. Each one is
 * relabelled for what this data actually measures and marked SUBSTITUTED below
 * — a number nobody can trace is worse than an admitted gap.
 *
 * The period control filters CLIENT-SIDE, off `items`. It never touches the
 * pending block: outstanding money is outstanding whatever month it was raised
 * in, and hiding an overdue invoice because it is two months old would be the
 * one filter bug that costs someone real money.
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Download, FileDown, Loader2, ReceiptText, Wallet,
} from 'lucide-react';
import { useFetchOnce } from '@/lib/hooks';
import { saveBlob } from '@/lib/api';
import {
  PageHeader, SectionLabel, StatRow, StatCard, Panel, Segmented,
  DataTable, Row, Cell, StatusPill, Pill, ActionButton, EmptyState,
} from '@/components/ui/console';
import type { Status, Accent } from '@/components/ui/console';

/* ─── contracts ─────────────────────────────────────────────────────────────
 * Mirrors the mapper at the bottom of GET /invoices in
 * EasyFix_Backend/routes/client/index.js — nothing is optimistic here. Note
 * `status` is a PAYMENT state (has the money arrived), not an invoice
 * lifecycle; the console's own status vocabulary is bent to fit it below.
 */

type Invoice = {
  id: number;
  /** Blank legacy invoice numbers are normalised to null server-side. */
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  total: number;
  paid: number;
  due: number;
  status: 'paid' | 'partial' | 'unpaid';
  pdfPath: string | null;
};

type InvoicesPayload = {
  summary: { billed: number; collected: number; outstanding: number; count: number };
  aging: { a0_30: number; a31_60: number; a60plus: number; unpaid: number };
  items: Invoice[];
};

/* ─── money + dates ─────────────────────────────────────────────────────── */

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const rupees = (n: number) => `₹${INR.format(Math.round(n || 0))}`;

/** Lakh/crore for the headline figures — ₹1,24,00,000 does not read at a glance. */
function rupeesShort(n: number) {
  const v = Math.abs(n || 0);
  if (v >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return rupees(n);
}

/**
 * MySQL hands back DATE columns as bare `YYYY-MM-DD` and DATETIMEs as
 * `YYYY-MM-DD HH:MM:SS` or an ISO instant. A bare date parsed by `new Date()`
 * is read as UTC midnight and lands on the PREVIOUS day west of Greenwich, so
 * it is built as a local date instead.
 */
function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  const d = plain
    ? new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]))
    : new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmtDate = (s: string | null) => {
  const d = parseDate(s);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
};
const ymd = (s: string | null) => {
  const d = parseDate(s);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Positive = past its due date by that many days. Null = no due date on file. */
function overdueDays(inv: Invoice, today: Date): number | null {
  const due = parseDate(inv.dueDate);
  return due ? Math.round((today.getTime() - startOfDay(due).getTime()) / DAY) : null;
}

/* ─── period ────────────────────────────────────────────────────────────────
 * The mock says "this month" on two cards and a month name on the register.
 * `items` is all-time, so a month has to be cut here. The window is closed on
 * the left and open on the right, and rows with NO invoice date (legacy blanks)
 * cannot be placed in a month at all — they surface only under "All".
 */

type PeriodKey = 'month' | 'last' | 'quarter' | 'all';

const PERIODS = [
  { value: 'month' as const, label: 'This month' },
  { value: 'last' as const, label: 'Last month' },
  { value: 'quarter' as const, label: 'Last 3 months' },
  { value: 'all' as const, label: 'All' },
];

function periodRange(key: PeriodKey, now: Date): { from: Date | null; to: Date | null; label: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const monthName = (d: Date) => d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  if (key === 'month') return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1), label: monthName(now) };
  if (key === 'last') {
    const prev = new Date(y, m - 1, 1);
    return { from: prev, to: new Date(y, m, 1), label: monthName(prev) };
  }
  if (key === 'quarter') return { from: new Date(y, m - 2, 1), to: new Date(y, m + 1, 1), label: 'last 3 months' };
  return { from: null, to: null, label: 'all time' };
}

/* ─── status vocabulary ─────────────────────────────────────────────────────
 * SUBSTITUTED: the mock's column is an invoice LIFECYCLE — paid / acknowledged
 * / sent. tbl_client_invoice records no acknowledgement and no send event, only
 * how much of each invoice has been received. So the console's status colours
 * are reused (they must mean the same thing on every screen) with the labels
 * corrected to the payment state the payload actually reports.
 */
const PAYMENT: Record<Invoice['status'], { status: Status; label: string }> = {
  paid: { status: 'paid', label: 'Paid' },
  partial: { status: 'partial', label: 'Part paid' },
  unpaid: { status: 'sent', label: 'Unpaid' },
};

/** Severity of a due amount by how long it has been sitting there. */
function overdueAccent(days: number | null): Accent {
  if (days == null) return 'info';
  if (days > 60) return 'brand';
  if (days > 0) return 'warning';
  return 'success';
}

/* PDF paths are stored relative to the document host, exactly as the previous
 * build resolved them. An absolute URL is passed straight through. */
const FILE_BASE = (process.env.NEXT_PUBLIC_FILE_BASE_URL || '/easydoc').replace(/\/+$/, '');
const pdfUrl = (p: string) => (/^https?:\/\//.test(p) ? p : `${FILE_BASE}/${p.replace(/^\/+/, '')}`);

/** The pending table shows this many rows; the rest are summarised in its footer. */
const PENDING_ROWS = 8;

export default function InvoicesPage() {
  const { data, loading, error, reload } = useFetchOnce<InvoicesPayload>('/invoices');
  const [period, setPeriod] = useState<PeriodKey>('month');

  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => startOfDay(now), [now]);
  const range = useMemo(() => periodRange(period, now), [period, now]);

  const items = useMemo(() => data?.items ?? [], [data]);

  /* Invoices RAISED inside the selected window, and what they are worth. */
  const scoped = useMemo(() => {
    const rows = items.filter((inv) => {
      if (!range.from || !range.to) return true;
      const d = parseDate(inv.invoiceDate);
      return d ? d >= range.from && d < range.to : false;
    });
    return {
      rows,
      billed: rows.reduce((a, r) => a + (r.total || 0), 0),
      paid: rows.reduce((a, r) => a + (r.paid || 0), 0),
      settled: rows.filter((r) => r.status === 'paid').length,
    };
  }, [items, range]);

  /* Everything still owed, most overdue first — the order you would work it in.
     Invoices with no due date sort last: they cannot be aged, only listed. */
  const pending = useMemo(() => {
    const rows = items.filter((inv) => (inv.due || 0) > 0);
    return rows.sort((a, b) => {
      const da = overdueDays(a, today);
      const db = overdueDays(b, today);
      if (da == null) return db == null ? 0 : 1;
      if (db == null) return -1;
      return db - da;
    });
  }, [items, today]);

  /*
   * Export = the rows currently on screen, built in the browser. There is no
   * server-side invoice export (GET /export/jobs is jobs-only), and inventing
   * a route from the client would be the wrong place to put it — this exports
   * precisely what the table shows, columns and all.
   */
  function exportCsv() {
    const esc = (v: string | number) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ['Invoice', 'Invoice date', 'Due date', 'Amount', 'Paid', 'Due', 'Payment status'];
    const lines = [head.join(',')];
    for (const r of scoped.rows) {
      lines.push([
        r.invoiceNumber || `#${r.id}`, ymd(r.invoiceDate), ymd(r.dueDate),
        Math.round(r.total || 0), Math.round(r.paid || 0), Math.round(r.due || 0),
        PAYMENT[r.status].label,
      ].map(esc).join(','));
    }
    // Built locally rather than fetched, so this needs the SAVE half only —
    // saveBlob() owns the two details every hand-rolled copy of this got wrong
    // somewhere (anchor in the document for Firefox, revoke on a later tick).
    saveBlob(
      new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
      `invoices-${period}-${ymd(new Date().toISOString())}.csv`,
    );
  }

  if (loading) {
    return (
      <div className="bg-surface rounded-xl border border-ink-100 p-10 text-center">
        <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" aria-hidden />
        <div className="mt-2 text-sm text-ink-500">Loading your invoices…</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <Panel accent="brand">
        <EmptyState
          icon={AlertTriangle}
          title="Could not load your invoices"
          sub={error || 'The billing service did not respond.'}
          action={<ActionButton onClick={() => { void reload(); }}>Try Again</ActionButton>}
        />
      </Panel>
    );
  }

  const { summary, aging } = data;
  const capped = items.length >= 300; // the endpoint's LIMIT — say so rather than imply completeness
  /*
   * `items` stops at that LIMIT, so counting the unpaid invoices by filtering
   * it UNDERSTATES them for any client with more than 300 invoices on file —
   * and the ones it drops are the OLDEST, i.e. the most overdue. `aging.unpaid`
   * is the database's own count over every raised invoice, on exactly this
   * page's predicate (due > 0), so the count comes from there and only the
   * ROWS come from `items`. Math.max keeps the two from ever disagreeing.
   */
  const shown = Math.min(pending.length, PENDING_ROWS);
  const unpaidCount = Math.max(aging.unpaid, pending.length);
  const hidden = Math.max(0, unpaidCount - shown);

  return (
    <>
      <PageHeader
        title="Invoicing"
        sub={
          `${summary.count.toLocaleString('en-IN')} invoice${summary.count === 1 ? '' : 's'} raised · `
          + `${rupeesShort(summary.billed)} billed · ${rupeesShort(summary.collected)} collected`
          + (capped ? ' · showing the latest 300' : '')
        }
        filters={<Segmented options={PERIODS} value={period} onChange={setPeriod} />}
      />

      <SectionLabel>Billing position</SectionLabel>
      <StatRow className="xl:grid-cols-3 mb-6">
        {/*
          SUBSTITUTED: the mock's first tile is "Ready to invoice — your action":
          jobs that passed QC and are waiting to be billed. That state lives on
          tbl_job.ready_for_billing, and the client jobs API exposes neither a
          filter for it nor a per-job value — and it is EasyFix who raises the
          invoice, so there is no client action behind it either. The money that
          IS waiting on this client is what has been billed and not yet paid, so
          the tile measures that and says so.
        */}
        <StatCard
          icon={AlertTriangle}
          accent="warning"
          label="Outstanding — awaiting your payment"
          value={<span className="text-money">{rupeesShort(summary.outstanding)}</span>}
          sub={
            aging.unpaid
              ? `${aging.unpaid} unpaid invoice${aging.unpaid === 1 ? '' : 's'}`
                + (aging.a60plus > 0 ? ` · ${rupees(aging.a60plus)} past 60 days` : '')
              : 'Every raised invoice is settled'
          }
        />
        <StatCard
          icon={ReceiptText}
          accent="info"
          label={`Invoices raised · ${range.label}`}
          value={<span className="text-money">{rupeesShort(scoped.billed)}</span>}
          sub={`${scoped.rows.length} invoice${scoped.rows.length === 1 ? '' : 's'} · ${rupeesShort(summary.billed)} billed all time`}
        />
        {/*
          SUBSTITUTED: the mock's "Paid this month" is cash RECEIVED this month.
          tbl_client_invoice carries total_paid_amount but no payment date, so
          there is no way to place a receipt in a month. This sums what has been
          received against the invoices RAISED in the window — a different cut,
          and the label names it.
        */}
        <StatCard
          icon={Wallet}
          accent="success"
          label={`Paid against ${range.label} invoices`}
          value={<span className="text-money">{rupeesShort(scoped.paid)}</span>}
          sub={`${scoped.settled} of ${scoped.rows.length} settled in full · ${rupeesShort(summary.collected)} collected all time`}
        />
      </StatRow>

      <SectionLabel>Pending your action</SectionLabel>
      {/*
        SUBSTITUTED: the mock's panel lists JOBS ready for invoice, with store,
        work done and a value per row. None of those four exist on
        tbl_client_invoice — the payload has no job, store or line-item
        dimension. The block keeps its job: the invoices that need something
        from this client, worked most-overdue first.

        Deliberately NOT filtered by the period control — see the file header.
      */}
      <Panel
        accent="warning"
        title={`Pending your action — ${unpaidCount} unpaid invoice${unpaidCount === 1 ? '' : 's'}`}
        action={summary.outstanding > 0 ? <Pill accent="warning">{rupeesShort(summary.outstanding)} due</Pill> : null}
        bodyClassName="p-0"
        className="mb-6"
      >
        {pending.length ? (
          <>
            <DataTable
              className="border-0 rounded-none"
              columns={[
                { key: 'invoice', label: 'Invoice' },
                { key: 'dates', label: 'Raised · due' },
                { key: 'age', label: 'Overdue' },
                { key: 'due', label: 'Amount due', align: 'right' },
                { key: 'pdf', label: 'PDF', align: 'right' },
              ]}
            >
              {pending.slice(0, PENDING_ROWS).map((inv) => {
                const od = overdueDays(inv, today);
                const accent = overdueAccent(od);
                return (
                  <Row key={inv.id} edge={accent}>
                    <Cell>
                      <div className="font-medium text-ink-900">{inv.invoiceNumber || `#${inv.id}`}</div>
                      <div className="text-xs text-ink-500 tabular-nums">Invoice {inv.id}</div>
                    </Cell>
                    <Cell>
                      <div className="text-ink-900">{fmtDate(inv.invoiceDate)}</div>
                      <div className="text-xs text-ink-500">due {fmtDate(inv.dueDate)}</div>
                    </Cell>
                    <Cell>
                      <Pill accent={accent}>
                        {od == null ? 'No due date' : od > 0 ? `${od}d over` : od === 0 ? 'Due today' : `${-od}d left`}
                      </Pill>
                    </Cell>
                    <Cell align="right">
                      <div className="font-semibold text-money tabular-nums">{rupees(inv.due)}</div>
                      {inv.paid > 0 ? (
                        <div className="text-xs text-ink-500 tabular-nums">{rupees(inv.paid)} of {rupees(inv.total)} paid</div>
                      ) : null}
                    </Cell>
                    <Cell align="right">
                      {inv.pdfPath ? (
                        <a
                          href={pdfUrl(inv.pdfPath)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-info hover:text-info-text"
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden />
                          Download
                        </a>
                      ) : (
                        <span className="text-xs text-ink-300">No PDF</span>
                      )}
                    </Cell>
                  </Row>
                );
              })}
            </DataTable>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-ink-100 text-xs">
              <span className="text-ink-500">
                {hidden > 0
                  ? `+ ${hidden} more unpaid invoice${hidden === 1 ? '' : 's'}`
                  : `All ${unpaidCount} unpaid invoice${unpaidCount === 1 ? '' : 's'} shown`}
              </span>
              <span className="text-ink-500">
                total <span className="font-semibold text-money tabular-nums">{rupees(summary.outstanding)}</span>
                {aging.a60plus > 0 ? (
                  <> · <span className="tabular-nums">{rupees(aging.a60plus)}</span> more than 60 days overdue</>
                ) : null}
              </span>
            </div>
          </>
        ) : (
          <EmptyState
            icon={unpaidCount ? AlertTriangle : CheckCircle2}
            title={unpaidCount ? 'Older invoices are still unpaid' : 'Nothing pending with you'}
            sub={
              /* Every unpaid invoice fell outside the latest 300 this endpoint
                 returns — saying "all settled" here would be flatly untrue. */
              unpaidCount
                ? `${rupees(summary.outstanding)} is due on ${unpaidCount} invoice${unpaidCount === 1 ? '' : 's'} raised before the latest 300 this page can load.`
                : summary.count
                  ? 'Every invoice raised against you has been paid in full.'
                  : 'No invoices have been raised against you yet.'
            }
          />
        )}
      </Panel>

      <SectionLabel>Invoices raised</SectionLabel>
      <Panel
        title={`Invoices raised · ${range.label}`}
        action={
          <ActionButton onClick={exportCsv} disabled={!scoped.rows.length}>
            <FileDown className="w-3.5 h-3.5" aria-hidden />
            Export CSV
          </ActionButton>
        }
        bodyClassName="p-0"
      >
        {scoped.rows.length ? (
          <DataTable
            className="border-0 rounded-none"
            columns={[
              { key: 'invoice', label: 'Invoice' },
              { key: 'period', label: 'Period · raised to due' },
              // SUBSTITUTED: the mock's "Jobs" column counts the jobs billed on
              // each invoice. tbl_client_invoice stores one row per invoice with
              // no line items and no job link, so the column reports what the
              // row does carry — how much of the invoice has been received.
              { key: 'paid', label: 'Paid', align: 'right' },
              { key: 'amount', label: 'Amount', align: 'right' },
              { key: 'status', label: 'Status', align: 'center' },
            ]}
          >
            {scoped.rows.map((inv) => (
              <Row key={inv.id}>
                <Cell>
                  <div className="font-medium text-ink-900">{inv.invoiceNumber || `#${inv.id}`}</div>
                  {inv.pdfPath ? (
                    <a
                      href={pdfUrl(inv.pdfPath)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-info hover:text-info-text"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden />
                      PDF
                    </a>
                  ) : (
                    <div className="text-xs text-ink-500 tabular-nums">Invoice {inv.id}</div>
                  )}
                </Cell>
                <Cell>
                  <div className="text-ink-900">
                    {fmtDate(inv.invoiceDate)} <span className="text-ink-300">→</span> {fmtDate(inv.dueDate)}
                  </div>
                </Cell>
                <Cell align="right">
                  <span className={inv.paid > 0 ? 'tabular-nums text-ink-900' : 'tabular-nums text-ink-300'}>
                    {rupees(inv.paid)}
                  </span>
                </Cell>
                <Cell align="right">
                  <span className="font-semibold text-money tabular-nums">{rupees(inv.total)}</span>
                </Cell>
                <Cell align="center">
                  <StatusPill status={PAYMENT[inv.status].status}>{PAYMENT[inv.status].label}</StatusPill>
                </Cell>
              </Row>
            ))}
          </DataTable>
        ) : (
          <EmptyState
            icon={ReceiptText}
            title={`No invoices raised in ${range.label}`}
            sub={items.length ? 'Older invoices are still on file.' : 'Nothing has been billed to you yet.'}
            action={items.length ? <ActionButton onClick={() => setPeriod('all')}>Show All Invoices</ActionButton> : undefined}
          />
        )}
      </Panel>
    </>
  );
}
