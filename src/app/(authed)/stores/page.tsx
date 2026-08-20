/**
 * Store SPOC view — the client's store / branch directory.
 *
 * The smallest screen in the console, and deliberately so: a header, a search,
 * a table. Everything visual comes from src/components/ui/console, so this file
 * is the contract for GET /stores plus the filtering that sits over it.
 *
 * WHERE THE ROWS COME FROM
 *
 *   GET /stores  →  { items: [...] }, one row per ACTIVE store
 *                   (`tbl_client_store WHERE fk_client_id = ? AND status = 1`,
 *                   ordered by store_code). It carries no paging, no `q` and no
 *                   totals — the whole directory arrives in one response.
 *
 * Two consequences worth knowing before reading a number off this page:
 *
 *   1. The search box filters IN THE BROWSER. The endpoint takes no query
 *      parameters, so a server round trip per keystroke would fetch the same
 *      rows back unchanged. The count in the toolbar therefore always says how
 *      many of the loaded rows matched, never "how many exist somewhere".
 *
 *   2. This endpoint is scoped to the CLIENT, not to the signed-in SPOC's
 *      booking subtree — a store-role SPOC sees every store their company has
 *      on file, not only the ones they book for. The header says "on file for
 *      <client>" rather than "your stores" because of that; it is the honest
 *      description of what the query returns.
 *
 * Inactive stores (status = 0) are invisible here by the same server filter, so
 * the count is an ACTIVE count. It is labelled that way rather than as a bare
 * "stores".
 */
'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Search, Store as StoreIcon } from 'lucide-react';
import { useFetchOnce } from '@/lib/hooks';
import { useSpoc } from '@/lib/spoc-context';
import {
  PageHeader, SectionLabel, Toolbar, DataTable, Row, Cell,
  Panel, EmptyState, ActionButton, Pill,
} from '@/components/ui/console';

/* ─── contract ──────────────────────────────────────────────────────────────
 * Exactly the nine columns the handler SELECTs, and every one of them nullable
 * except the key: tbl_client_store is filled by imports and by the ops team, and
 * the directory rows in the wild routinely arrive with no contact and no city.
 */
type StoreRow = {
  id: number;
  store_code: string | null;
  store_name: string | null;
  contact_name: string | null;
  contact_no: string | null;
  address: string | null;
  city_id: number | null;
  city_name: string | null;
  pin_code: string | null;
};

/** A blank cell that reads as "not on file" rather than as a rendering bug. */
const Missing = () => <span className="text-ink-300">—</span>;

const text = (v: string | null | undefined) => (v ?? '').trim();

/** Everything a row can be matched on, folded once per row per search. */
const haystack = (s: StoreRow) =>
  [s.store_code, s.store_name, s.city_name, s.contact_name, s.contact_no, s.pin_code, s.address]
    .map((v) => text(v).toLowerCase())
    .join(' ');

export default function StoresPage() {
  const spoc = useSpoc();
  const { data, loading, error, reload } = useFetchOnce<{ items: StoreRow[] }>('/stores');
  const [q, setQ] = useState('');

  const all = useMemo(() => data?.items ?? [], [data]);

  /* Local filter. Memoised on the query so typing does not re-fold every row
     on unrelated re-renders. */
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((s) => haystack(s).includes(needle));
  }, [all, q]);

  /* A store with neither a name nor a number against it is the one row on this
     page somebody has to act on, so it carries the severity rule. Derived from
     the row itself — no separate "incomplete" flag is being invented. */
  const noContact = useMemo(
    () => all.filter((s) => !text(s.contact_name) && !text(s.contact_no)).length,
    [all],
  );

  if (loading) {
    return (
      <div className="bg-surface rounded-xl border border-ink-100 p-10 text-center">
        <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" aria-hidden />
        <div className="mt-2 text-sm text-ink-500">Loading your store directory…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Panel accent="brand">
        <EmptyState
          icon={AlertTriangle}
          title="Could not load your stores"
          sub={error || 'The store directory did not respond.'}
          action={<ActionButton onClick={() => void reload()}>Try Again</ActionButton>}
        />
      </Panel>
    );
  }

  const client = text(spoc.client_name) || 'Your account';

  return (
    <>
      <PageHeader
        title="Store SPOC view"
        sub={`${all.length.toLocaleString('en-IN')} active store${all.length === 1 ? '' : 's'} on file for ${client}`}
        filters={
          noContact > 0 ? (
            // SUBSTITUTED: the mock puts scope chips here (city / region). The
            // directory endpoint takes no parameters, so a chip would be a
            // control that changes nothing. This says the one thing the payload
            // genuinely supports flagging — rows with no contact of any kind.
            <Pill accent="warning">
              {noContact} without a contact
            </Pill>
          ) : null
        }
      />

      <SectionLabel>Store directory</SectionLabel>

      <Toolbar
        count={
          q.trim()
            ? `${rows.length.toLocaleString('en-IN')} of ${all.length.toLocaleString('en-IN')} stores`
            : `${all.length.toLocaleString('en-IN')} store${all.length === 1 ? '' : 's'}`
        }
      >
        <div className="relative">
          <Search
            className="w-3.5 h-3.5 text-ink-300 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search stores"
            placeholder="Search code, store, city or contact…"
            /* No Input primitive exists in console.tsx; this is built from the
               same tokens and the same metrics as FilterChip so the toolbar row
               stays one line of chrome rather than two. */
            className="w-72 max-w-full rounded-full border border-ink-100 bg-surface pl-8 pr-3 py-1.5 text-xs text-ink-900 placeholder:text-ink-300 transition hover:border-ink-300 focus:border-primary focus:outline-none"
          />
        </div>
      </Toolbar>

      {rows.length === 0 ? (
        <Panel>
          {all.length === 0 ? (
            <EmptyState
              icon={StoreIcon}
              title="No stores on file"
              sub={`${client} has no active store or branch records yet. Your EasyFix account manager loads these, and new orders can still be raised without one.`}
            />
          ) : (
            <EmptyState
              icon={Search}
              title="No stores match that search"
              sub={`Nothing in the ${all.length.toLocaleString('en-IN')} loaded rows matches “${q.trim()}”.`}
              action={<ActionButton onClick={() => setQ('')}>Clear Search</ActionButton>}
            />
          )}
        </Panel>
      ) : (
        <DataTable
          columns={[
            { key: 'code', label: 'Store code' },
            { key: 'name', label: 'Store name' },
            { key: 'city', label: 'City' },
            // SUBSTITUTED: the mock's column is "SPOC". GET /stores carries no
            // assigned portal-SPOC user per store — tbl_client_store has only
            // contact_name, the store's own named contact — so the header says
            // which of the two this is.
            { key: 'spoc', label: 'Store contact' },
            { key: 'phone', label: 'Contact' },
          ]}
        >
          {rows.map((s) => {
            const phone = text(s.contact_no);
            const name = text(s.contact_name);
            return (
              <Row key={s.id} edge={!name && !phone ? 'warning' : undefined}>
                <Cell>
                  <span className="text-sm font-medium text-ink-900 tabular-nums whitespace-nowrap">
                    {text(s.store_code) || <Missing />}
                  </span>
                </Cell>
                <Cell>
                  <span className="block text-sm text-ink-900">{text(s.store_name) || <Missing />}</span>
                  {text(s.address) ? (
                    <span className="block text-xs text-ink-500 max-w-md truncate">{text(s.address)}</span>
                  ) : null}
                </Cell>
                <Cell>
                  <span className="block text-sm text-ink-700">{text(s.city_name) || <Missing />}</span>
                  {text(s.pin_code) ? (
                    <span className="block text-xs text-ink-500 tabular-nums">{text(s.pin_code)}</span>
                  ) : null}
                </Cell>
                <Cell>
                  <span className="text-sm text-ink-700">{name || <Missing />}</span>
                </Cell>
                <Cell>
                  {phone ? (
                    <a
                      href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                      className="text-sm text-info hover:text-info-text tabular-nums whitespace-nowrap"
                    >
                      {phone}
                    </a>
                  ) : (
                    <Missing />
                  )}
                </Cell>
              </Row>
            );
          })}
        </DataTable>
      )}
    </>
  );
}
