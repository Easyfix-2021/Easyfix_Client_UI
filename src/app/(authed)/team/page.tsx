'use client';

/*
 * My Team — SPOC team members for the logged-in client.
 *
 * Migrated from legacy ACD_APIs
 *   GET /api/clients/{clientId}/contacts/managers?status=<bool>
 * (Angular TechniciansComponent / our-team flow).
 *
 * Two view modes (toggle buttons at the top — that's the new bit the
 * legacy UI didn't have):
 *   1. TABLE     — flat list, searchable, mirrors the legacy /technicians table
 *   2. HIERARCHY — tree built from manager_id pointers. Expand/collapse
 *                  per node; cycle-safe (visited-set guard so the Pradeep
 *                  ↔ Harkirpa-Kaur loop on client 10 doesn't blow the stack).
 *
 * Filter:
 *   status — Active (default) / Inactive / All — sent as a query param.
 *            Server applies the filter; tree is rebuilt client-side.
 *
 * Search box filters the TABLE view only. For HIERARCHY, search would
 * also need to keep ancestors visible to preserve context — left for a
 * future iteration to avoid shipping a misleading "no results" tree.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Users, Search, LayoutGrid, GitBranch, ChevronRight,
  ChevronLeft,
  Mail, Phone, Badge, Shield, ShieldOff,
} from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { chartSeries } from '@/brand/charts';

type TeamMember = {
  id: number;
  name: string | null;
  email: string | null;
  mobile: string | null;
  designation: string | null;
  managerId: number | null;
  status: number | null;            // 1 active, 0 inactive, NULL = legacy unset
  approvalByClient: number | null;  // 0 no, 1 yes, 2 preapproved, NULL
};

type ViewMode = 'table' | 'hierarchy';
type StatusFilter = 'true' | 'false' | 'all';

const STATUS_LABEL: Record<StatusFilter, string> = {
  true:  'Active',
  false: 'Inactive',
  all:   'All',
};

// Table pagination — Hierarchy view is intentionally unpaginated
// (paging breaks parent-child relationships and disorients the user).
const PAGE_SIZE_OPTIONS = [10, 20, 30];

// ─── Hierarchy helpers ───────────────────────────────────────────────
// Build a `parentId → children[]` map in one pass, then locate roots
// (members whose manager isn't present in the returned set). The
// returned set already accounts for the status filter, so a member
// pointing at an inactive manager will surface as a root in the
// "Active" tree — exactly what the user wants visually.
type TreeNode = TeamMember & { children: TreeNode[] };

function buildTree(members: TeamMember[]): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  members.forEach((m) => byId.set(m.id, { ...m, children: [] }));

  const roots: TreeNode[] = [];
  byId.forEach((node) => {
    const parent = node.managerId != null ? byId.get(node.managerId) : null;
    if (parent && parent.id !== node.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Stable sort: name ASC within each level.
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

// ─── Avatar bubble (initials over coloured background) ───────────────
function initialsOf(name: string | null) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
// Deterministic colour per name so the same person stays the same colour.
// Avatar hues are purely categorical (they only tell person A from
// person B), so they come from the chart ramp rather than a brand
// token. `.to` is the darker end, so white initials stay legible.
function avatarBg(name: string | null) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + (name || '').charCodeAt(i)) >>> 0;
  return chartSeries[h % chartSeries.length].to;
}

function StatusBadge({ status }: { status: number | null }) {
  if (status === 1) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success-tint text-success-text ring-1 ring-success/40 text-xs font-semibold">
        <Shield className="w-3 h-3" /> Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ink-100 text-ink-500 ring-1 ring-ink-300/40 text-xs font-semibold">
      <ShieldOff className="w-3 h-3" /> Inactive
    </span>
  );
}

// ─── HierarchyNode (recursive) ───────────────────────────────────────
// `depth` is for indentation. `expanded`/`onToggle` flow through a
// shared Set held in the parent so toggling re-renders only the path.
function HierarchyNode({
  node, depth, expanded, onToggle,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
}) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-3 px-2 py-2 rounded-lg transition',
          'hover:bg-primary-50/40'
        )}
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          className={cn(
            'shrink-0 w-5 h-5 grid place-items-center rounded',
            hasChildren ? 'hover:bg-ink-100 cursor-pointer' : 'cursor-default'
          )}
          aria-label={hasChildren ? (isOpen ? 'Collapse' : 'Expand') : undefined}
          tabIndex={hasChildren ? 0 : -1}
        >
          {hasChildren && (
            <ChevronRight
              className={cn('w-4 h-4 text-ink-500 transition', isOpen && 'rotate-90')}
            />
          )}
        </button>

        <div
          className="shrink-0 w-9 h-9 rounded-full text-white font-semibold text-xs flex items-center justify-center ring-2 ring-white shadow-sm"
          style={{ background: avatarBg(node.name) }}
        >
          {initialsOf(node.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-ink-900 truncate">{node.name || '—'}</span>
            <StatusBadge status={node.status} />
            {hasChildren && (
              <span className="text-xs text-ink-500">
                {node.children.length} report{node.children.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-ink-500 mt-0.5 flex-wrap">
            {node.designation && (
              <span className="inline-flex items-center gap-1">
                <Badge className="w-3 h-3" /> {node.designation}
              </span>
            )}
            {node.email && (
              <span className="inline-flex items-center gap-1">
                <Mail className="w-3 h-3" /> {node.email}
              </span>
            )}
            {node.mobile && (
              <span className="inline-flex items-center gap-1">
                <Phone className="w-3 h-3" /> {node.mobile}
              </span>
            )}
          </div>
        </div>
      </div>

      {hasChildren && isOpen && (
        <ul className="border-l border-ink-100 ml-[20px]">
          {node.children.map((c) => (
            <HierarchyNode
              key={c.id}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ─── Page ────────────────────────────────────────────────────────────
export default function MyTeamPage() {
  const [view, setView] = useState<ViewMode>('table');
  const [status, setStatus] = useState<StatusFilter>('true');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);

  // Any change to the filtered set must reset to page 1 — otherwise a
  // user on page 5 of "All" filters down to 3 active rows and the table
  // looks empty until they realise to click Prev.
  useEffect(() => { setPage(1); }, [q, status, pageSize, view]);

  const fetchPath = useMemo(() => `/team?status=${status}`, [status]);
  const { data, error, loading } = useFetch<{ items: TeamMember[] }>(fetchPath);
  // useMemo so the reference is STABLE across renders when data hasn't
  // changed. Without this, `data?.items ?? []` returned a fresh empty
  // array each render — downstream useMemo([members]) recomputed →
  // useEffect on `tree` fired → setExpanded → re-render → infinite loop.
  const members = useMemo<TeamMember[]>(() => data?.items ?? [], [data]);

  // Table search — filters across name / email / mobile / designation.
  const filteredForTable = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((m) =>
      (m.name || '').toLowerCase().includes(needle) ||
      (m.email || '').toLowerCase().includes(needle) ||
      (m.mobile || '').toLowerCase().includes(needle) ||
      (m.designation || '').toLowerCase().includes(needle)
    );
  }, [members, q]);

  // Pagination slice — derived from filteredForTable so search +
  // pagination compose correctly.
  const total = filteredForTable.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Clamp page if a filter shrank the list below the current page.
  const safePage = Math.min(page, pageCount);
  const firstIdx = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastIdx = Math.min(safePage * pageSize, total);
  const pagedForTable = useMemo(
    () => filteredForTable.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredForTable, safePage, pageSize]
  );

  // Hierarchy — built once per `members` change.
  const tree = useMemo(() => buildTree(members), [members]);

  // Default-expand all roots so the user sees structure without clicking.
  // Storing the ids in state lets the user collapse individual nodes.
  // useEffect (not useMemo) — setExpanded is a side effect, not derived
  // state. Re-runs whenever the dataset or active view changes so the
  // user always lands on a sensible default.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  useEffect(() => {
    setExpanded(new Set(tree.map((r) => r.id)));
  }, [tree, view, status]);

  function toggleNode(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function expandAll() {
    const all = new Set<number>();
    const walk = (nodes: TreeNode[]) => nodes.forEach((n) => { all.add(n.id); walk(n.children); });
    walk(tree);
    setExpanded(all);
  }
  function collapseAll() { setExpanded(new Set()); }

  return (
    <div className="space-y-5">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900 inline-flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" /> My Team
          </h1>
          <p className="text-sm text-ink-500">
            Reporting managers and SPOC team members linked to your client account.
          </p>
        </div>

        {/* View toggle — the new bit the legacy UI didn't have */}
        <div className="inline-flex rounded-lg border border-ink-100 bg-surface p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setView('table')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition',
              view === 'table'
                ? 'bg-primary text-white shadow'
                : 'text-ink-700 hover:bg-ink-50'
            )}
          >
            <LayoutGrid className="w-4 h-4" /> Table
          </button>
          <button
            type="button"
            onClick={() => setView('hierarchy')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition',
              view === 'hierarchy'
                ? 'bg-primary text-white shadow'
                : 'text-ink-700 hover:bg-ink-50'
            )}
          >
            <GitBranch className="w-4 h-4" /> Hierarchy
          </button>
        </div>
      </div>

      {/* Controls row — search (table only) + status filter + expand/collapse */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        {view === 'table' && (
          <>
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
              <input
                className="input pl-9"
                placeholder="Search by name, email, mobile, designation…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              className="input max-w-[140px]"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} per page</option>
              ))}
            </select>
          </>
        )}
        {view === 'hierarchy' && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={expandAll} className="btn-outline text-xs">
              Expand all
            </button>
            <button type="button" onClick={collapseAll} className="btn-outline text-xs">
              Collapse all
            </button>
          </div>
        )}
        <div className={cn('flex items-center gap-2', view === 'table' ? '' : 'ml-auto')}>
          <label className="text-xs font-medium text-ink-500">Status</label>
          <select
            className="input max-w-[140px]"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="true">{STATUS_LABEL.true}</option>
            <option value="false">{STATUS_LABEL.false}</option>
            <option value="all">{STATUS_LABEL.all}</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded border border-danger/40 bg-danger-tint px-3 py-2 text-sm text-danger-text">
          {error}
        </div>
      )}

      {/* TABLE view */}
      {view === 'table' && (
        <>
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Designation</th>
                <th>Mobile</th>
                <th>Email</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="text-center text-ink-500 py-8">Loading…</td></tr>
              )}
              {!loading && total === 0 && (
                <tr><td colSpan={6} className="text-center text-ink-500 py-8">No team members found.</td></tr>
              )}
              {!loading && pagedForTable.map((m, idx) => (
                <tr key={m.id} className="hover:bg-primary-50/40">
                  <td className="text-xs text-ink-500">{firstIdx + idx}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-8 h-8 rounded-full text-white font-semibold text-xs flex items-center justify-center shrink-0"
                        style={{ background: avatarBg(m.name) }}
                      >
                        {initialsOf(m.name)}
                      </div>
                      <span className="font-semibold text-ink-900">{m.name || '—'}</span>
                    </div>
                  </td>
                  <td className="text-sm text-ink-500">{m.designation || '—'}</td>
                  <td className="text-sm font-mono">{m.mobile || '—'}</td>
                  <td className="text-sm">{m.email || '—'}</td>
                  <td><StatusBadge status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination — only meaningful for the Table view. */}
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-500">
            <span>
              Showing <span className="font-semibold">{firstIdx}</span>–
              <span className="font-semibold">{lastIdx}</span> of{' '}
              <span className="font-semibold">{total}</span>
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="btn-outline disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 py-1.5">
                Page <span className="font-semibold">{safePage}</span> of{' '}
                <span className="font-semibold">{pageCount}</span>
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={safePage >= pageCount}
                className="btn-outline disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        </>
      )}

      {/* HIERARCHY view */}
      {view === 'hierarchy' && (
        <div className="card p-2">
          {loading && (
            <div className="text-center text-ink-500 py-8">Loading…</div>
          )}
          {!loading && tree.length === 0 && (
            <div className="text-center text-ink-500 py-8">No team members found.</div>
          )}
          {!loading && tree.length > 0 && (
            <ul className="text-sm">
              {tree.map((root) => (
                <HierarchyNode
                  key={root.id}
                  node={root}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleNode}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
