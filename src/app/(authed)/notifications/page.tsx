'use client';

/*
 * SPOC Notifications inbox.
 *
 * Backend contract (routes/client/index.js):
 *   GET   /api/client/notices                — active notices for this SPOC
 *   GET   /api/client/notices/unread-count   — { count } (used by sidebar bell)
 *   PATCH /api/client/notices/:id/read       — idempotent mark-read
 *   PATCH /api/client/notices/read-all       — bulk mark-all-read
 *
 * Source schema: tbl_notice (rebranded from legacy tbl_notices /
 * notice_catg). Notices flagged with target_surfaces containing
 * 'client' surface here. Read-receipts live in tbl_notice_read keyed
 * on (notice_id, surface='client', reader_type='client', reader_id=SPOC.id).
 *
 * Layout: inbox-style feed (Gmail/Notion style) with tabs at top
 * (All · Unread · Pinned). Each row:
 *   - colored category chip (category.color from DB → CSS hex)
 *   - title + body excerpt
 *   - relative time (publish_at, falls back to created_at)
 *   - unread dot on the right
 *
 * Interaction:
 *   - Tap row → expands inline + immediately marks read (matches
 *     WhatsApp/Slack: seen = read).
 *   - "Mark all as read" top-right button (only when there's at least
 *     one unread to act on).
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, BellRing, CheckCheck, Pin, ExternalLink, AlertCircle,
  ArrowLeft,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetchOnce } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { tokens } from '@/brand/tokens';
import { formatIst, parseIstDateTime } from '@/lib/format';

type Notice = {
  notice_id: number;
  title: string;
  body: string;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  target_surfaces: string;
  action_url: string | null;
  is_pinned: number | boolean;
  status: string;
  effective_status: 'draft' | 'scheduled' | 'published' | 'archived' | 'expired';
  publish_at: string | null;
  expire_at: string | null;
  created_at: string;
  is_read: boolean;
  images: string[];
};

type TabKey = 'all' | 'unread' | 'pinned';

export default function NotificationsPage() {
  const router = useRouter();
  const { data, loading, error } = useFetchOnce<{ items: Notice[] }>('/notices?limit=100');

  const [items, setItems] = useState<Notice[]>([]);
  const [tab, setTab] = useState<TabKey>('all');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [opErr, setOpErr] = useState<string | null>(null);

  useEffect(() => {
    if (data?.items) setItems(data.items);
  }, [data]);

  // Tab counts feed the badge in each tab button. Memoised so a
  // re-render doesn't re-walk the whole list on every keystroke /
  // hover. Pinned coercion guards against the mysql2 TINYINT(1)
  // returning 1 / "1" / true in different envs.
  const counts = useMemo(() => ({
    all:    items.length,
    unread: items.filter((n) => !n.is_read).length,
    pinned: items.filter((n) => Number(n.is_pinned) === 1).length,
  }), [items]);

  const visible = useMemo(() => {
    if (tab === 'unread') return items.filter((n) => !n.is_read);
    if (tab === 'pinned') return items.filter((n) => Number(n.is_pinned) === 1);
    return items;
  }, [items, tab]);

  async function toggleExpand(notice: Notice) {
    // Auto-mark-read on first expansion. We update local state
    // optimistically so the dot disappears instantly — the network
    // call's outcome is non-blocking (idempotent on the backend, so
    // a transient failure on a re-tap is harmless).
    const willOpen = !expanded.has(notice.notice_id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(notice.notice_id)) next.delete(notice.notice_id);
      else next.add(notice.notice_id);
      return next;
    });
    if (willOpen && !notice.is_read) {
      setItems((curr) => curr.map((n) =>
        n.notice_id === notice.notice_id ? { ...n, is_read: true } : n));
      try {
        await api.patch(`/notices/${notice.notice_id}/read`, {});
        // Tell the sidebar bell to repaint immediately instead of
        // waiting for the 60s poll. Layout subscribes to this event.
        window.dispatchEvent(new CustomEvent('notices:invalidate'));
      } catch {
        // Silent. Re-opening will retry — the unread badge will
        // self-heal on next page mount via the live /notices fetch.
      }
    }
  }

  async function markAllRead() {
    if (counts.unread === 0) return;
    setBusy(true); setOpErr(null);
    // Optimistic — flip all unread → read locally, then call API.
    // Roll back on error so the user sees the true state.
    const snapshot = items;
    setItems((curr) => curr.map((n) => ({ ...n, is_read: true })));
    try {
      await api.patch('/notices/read-all', {});
      window.dispatchEvent(new CustomEvent('notices:invalidate'));
    } catch (e) {
      setItems(snapshot);
      setOpErr(e instanceof ApiError ? e.message : 'Could not mark all as read.');
    } finally { setBusy(false); }
  }

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Page header — back chip on top so the SPOC always has a
          1-tap exit back to wherever they came from (dashboard, job
          detail, etc.). `router.back()` honours real history; if the
          user landed here via a direct URL with no history, we
          fall through to /dashboard so they don't get stranded. */}
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined' && window.history.length > 1) {
            router.back();
          } else {
            router.push('/dashboard');
          }
        }}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-primary transition group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back
      </button>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900 inline-flex items-center gap-2">
            <BellRing className="w-6 h-6 text-warning" />
            Notifications
          </h1>
        </div>
        <button
          type="button"
          onClick={markAllRead}
          disabled={busy || counts.unread === 0}
          className="px-3 py-2 text-sm font-semibold rounded-lg border border-ink-100 bg-surface hover:bg-ink-50 inline-flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
          title={counts.unread === 0 ? 'Nothing to mark' : `Mark ${counts.unread} as read`}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4 text-success" />}
          Mark all as read
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-ink-100">
        {(['all', 'unread', 'pinned'] as TabKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              'px-3 py-2 text-sm font-semibold inline-flex items-center gap-1.5 border-b-2 transition -mb-px',
              tab === k
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-500 hover:text-ink-900'
            )}
          >
            {k === 'all'    && 'All'}
            {k === 'unread' && 'Unread'}
            {k === 'pinned' && (<><Pin className="w-3.5 h-3.5" /> Pinned</>)}
            <span className={cn(
              'ml-1 inline-flex items-center justify-center min-w-[1.25rem] px-1.5 h-5 text-xs font-semibold rounded-full',
              tab === k ? 'bg-primary text-white' : 'bg-ink-100 text-ink-500',
            )}>
              {counts[k]}
            </span>
          </button>
        ))}
      </div>

      {opErr && (
        <div className="rounded-lg bg-danger-tint border border-danger/30 px-3 py-2 text-xs text-danger-text inline-flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-danger" />
          {opErr}
        </div>
      )}

      {/* Feed */}
      {loading ? (
        <div className="bg-surface rounded-2xl shadow-sm ring-1 ring-ink-100 p-10 text-center">
          <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" />
          <div className="mt-2 text-sm text-ink-500">Loading notifications…</div>
        </div>
      ) : error ? (
        <div className="bg-danger-tint border border-danger/30 rounded-2xl p-6 text-center text-sm text-danger-text">
          {error}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <ul className="bg-surface rounded-2xl shadow-sm ring-1 ring-ink-100 divide-y divide-ink-100 overflow-hidden">
          {visible.map((n) => (
            <NoticeRow
              key={n.notice_id}
              notice={n}
              expanded={expanded.has(n.notice_id)}
              onToggle={() => toggleExpand(n)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Components ───────────────────────────────────────────────── */

function NoticeRow({
  notice, expanded, onToggle,
}: {
  notice: Notice;
  expanded: boolean;
  onToggle: () => void;
}) {
  const pinned = Number(notice.is_pinned) === 1;
  const color = notice.category_color || tokens['ink-500'];

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full text-left px-4 py-3 flex items-start gap-3 transition',
          notice.is_read ? 'hover:bg-ink-50' : 'bg-warning-tint/40 hover:bg-warning-tint'
        )}
      >
        {/* Category color band — a left-edge stripe + a chip below the
            title. The stripe gives a quick visual signal even for
            colour-blind users when the chip text is also present. */}
        <div
          className="w-1 self-stretch rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {notice.category_name && (
              <span
                className="inline-flex items-center text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: color }}
              >
                {notice.category_name}
              </span>
            )}
            {pinned && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-warning-tint text-warning-text">
                <Pin className="w-3 h-3" /> Pinned
              </span>
            )}
            <span className="text-xs text-ink-300 ml-auto shrink-0">
              {timeAgo(notice.publish_at || notice.created_at)}
            </span>
          </div>
          <h3 className={cn(
            'mt-1 text-sm leading-snug',
            notice.is_read ? 'font-semibold text-ink-700' : 'font-semibold text-ink-900'
          )}>
            {notice.title}
          </h3>
          {/* Body: short excerpt by default, full text on expand. */}
          <p className={cn(
            'mt-1 text-sm text-ink-500 whitespace-pre-wrap',
            !expanded && 'line-clamp-2'
          )}>
            {notice.body}
          </p>
          {expanded && notice.images?.length > 0 && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {notice.images.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt=""
                  className="w-full aspect-video object-cover rounded-md border border-ink-100"
                />
              ))}
            </div>
          )}
          {expanded && notice.action_url && (
            <div className="mt-3">
              <a
                href={notice.action_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Learn more <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
        {/* Unread dot — anchored top-right so the row's primary content
            isn't shifted by its presence/absence. */}
        {!notice.is_read && (
          <span className="w-2 h-2 mt-1.5 rounded-full bg-primary shrink-0" />
        )}
      </button>
    </li>
  );
}

function EmptyState({ tab }: { tab: TabKey }) {
  const messages: Record<TabKey, { title: string; sub: string }> = {
    all: {
      title: 'No notifications yet',
      sub: 'When EasyFix or your client admin posts an announcement, it will land here.',
    },
    unread: {
      title: 'All caught up',
      sub: 'You\'ve read every notification. We\'ll let you know when there\'s something new.',
    },
    pinned: {
      title: 'No pinned notifications',
      sub: 'Important announcements that need long-term visibility will be pinned to the top.',
    },
  };
  const m = messages[tab];
  return (
    <div className="bg-surface rounded-2xl shadow-sm ring-1 ring-ink-100 p-10 text-center">
      <BellRing className="w-10 h-10 mx-auto text-ink-300" />
      <h3 className="mt-3 text-sm font-semibold text-ink-700">{m.title}</h3>
      <p className="mt-1 text-xs text-ink-500 max-w-xs mx-auto">{m.sub}</p>
    </div>
  );
}

/*
 * Relative-time formatter used in the row meta. Falls through to a
 * locale date for anything > 14 days so the user gets an absolute
 * anchor for old notices instead of "342 days ago".
 */
function timeAgo(iso: string | null): string {
  if (!iso) return '';
  /*
   * parseIstDateTime, because this value feeds ARITHMETIC and not just a
   * render. Read as browser-local from a zone behind IST the instant lands in
   * the future, diffMs goes negative and — unlike the CRM's relativeTime,
   * which clamps — this ladder would print "-37800s ago".
   */
  const d = parseIstDateTime(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60)        return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60)        return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24)         return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14)        return `${day}d ago`;
  return formatIst(d, { day: '2-digit', month: 'short', year: 'numeric' }, { fallback: '' });
}
