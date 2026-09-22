'use client';

/*
 * Notifications — TWO unrelated shapes behind one page, kept in two
 * separate types on purpose (routes/client/index.js in EasyFix_Backend):
 *
 *   JobNotice     GET  /notices              — dashboard_notification_log
 *                 rows, one per job EVENT (assigned / completed / cancelled,
 *                 and — new for the "Send Request to Client" material-
 *                 approval flow — a material request). Shape: notice_id,
 *                 title, message, is_read, created_at, job_id.
 *                 Marked read via PATCH /notices/read { notice_id? } —
 *                 omit notice_id to mark ALL of them read.
 *
 *   Announcement  GET  /notice-board          — tbl_notice rows, CRM-
 *                 authored announcements (category, pin, images, an
 *                 optional action_url). Marked read via
 *                 PATCH /notices/:id/read and PATCH /notices/read-all — a
 *                 DIFFERENT pair of endpoints that happen to share the
 *                 /notices/* prefix with the job-event ones above.
 *
 * Earlier version of this page fetched /notices but typed it as an
 * Announcement (category_id, action_url, images…) and posted mark-read to
 * the Announcement endpoints — so a job notification's read tap wrote a
 * harmless, useless row into tbl_notice_read and the job event itself never
 * flipped to read. The two lists below never share a type or an endpoint.
 */

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, BellRing, CheckCheck, Pin, ExternalLink, AlertCircle,
  ArrowLeft, Briefcase, Megaphone,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetchOnce } from '@/lib/hooks';
import { openJobDrawer } from '@/components/job-drawer';
import { cn } from '@/lib/utils';
import { tokens } from '@/brand/tokens';
import { formatIst, parseIstDateTime } from '@/lib/format';

type JobNotice = {
  notice_id: number;
  title: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
  job_id: number | null;
};

type Announcement = {
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

type Source = 'updates' | 'announcements';

export default function NotificationsPage() {
  const router = useRouter();
  const [source, setSource] = useState<Source>('updates');

  const jobFeed = useFetchOnce<{ items: JobNotice[] }>('/notices?limit=100');
  const board = useFetchOnce<{ items: Announcement[] }>('/notice-board');

  const [jobItems, setJobItems] = useState<JobNotice[]>([]);
  const [boardItems, setBoardItems] = useState<Announcement[]>([]);
  useEffect(() => { if (jobFeed.data?.items) setJobItems(jobFeed.data.items); }, [jobFeed.data]);
  useEffect(() => { if (board.data?.items) setBoardItems(board.data.items); }, [board.data]);

  const jobUnread = useMemo(() => jobItems.filter((n) => !n.is_read).length, [jobItems]);
  const boardUnread = useMemo(() => boardItems.filter((n) => !n.is_read).length, [boardItems]);

  return (
    <div className="space-y-4">
      {/* Back chip — router.back() honours real history; a direct URL with no
          history falls through to /dashboard so the reader isn't stranded. */}
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined' && window.history.length > 1) router.back();
          else router.push('/dashboard');
        }}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-primary transition group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back
      </button>

      <h1 className="text-2xl font-semibold text-ink-900 inline-flex items-center gap-2">
        <BellRing className="w-6 h-6 text-warning" />
        Notifications
      </h1>

      {/* Source tabs — the two feeds never mix in one list. */}
      <div className="flex items-center gap-1 border-b border-ink-100">
        <SourceTabButton
          active={source === 'updates'}
          onClick={() => setSource('updates')}
          icon={Briefcase}
          label="Job Updates"
          count={jobUnread}
        />
        <SourceTabButton
          active={source === 'announcements'}
          onClick={() => setSource('announcements')}
          icon={Megaphone}
          label="Announcements"
          count={boardUnread}
        />
      </div>

      {source === 'updates' ? (
        <JobUpdatesFeed
          items={jobItems}
          setItems={setJobItems}
          loading={jobFeed.loading}
          error={jobFeed.error}
        />
      ) : (
        <AnnouncementsFeed
          items={boardItems}
          setItems={setBoardItems}
          loading={board.loading}
          error={board.error}
        />
      )}
    </div>
  );
}

function SourceTabButton({
  active, onClick, icon: Icon, label, count,
}: {
  active: boolean; onClick: () => void; icon: typeof Briefcase; label: string; count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-2 text-sm font-semibold inline-flex items-center gap-1.5 border-b-2 transition -mb-px',
        active ? 'border-primary text-primary' : 'border-transparent text-ink-500 hover:text-ink-900'
      )}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
      {label}
      {count > 0 && (
        <span className={cn(
          'ml-1 inline-flex items-center justify-center min-w-[1.25rem] px-1.5 h-5 text-xs font-semibold rounded-full',
          active ? 'bg-primary text-white' : 'bg-ink-100 text-ink-500',
        )}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

/* ─── Job Updates (GET /notices, PATCH /notices/read) ────────────────── */

function JobUpdatesFeed({
  items, setItems, loading, error,
}: {
  items: JobNotice[];
  setItems: Dispatch<SetStateAction<JobNotice[]>>;
  loading: boolean;
  error: string | null;
}) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opErr, setOpErr] = useState<string | null>(null);

  const unreadCount = items.filter((n) => !n.is_read).length;
  const visible = unreadOnly ? items.filter((n) => !n.is_read) : items;

  async function openNotice(n: JobNotice) {
    if (!n.is_read) {
      // Optimistic — the row flips to read immediately; the network call's
      // outcome is non-blocking (the route is idempotent on a re-tap).
      setItems((curr) => curr.map((x) => (x.notice_id === n.notice_id ? { ...x, is_read: true } : x)));
      try {
        await api.patch('/notices/read', { notice_id: n.notice_id });
        window.dispatchEvent(new CustomEvent('notices:invalidate'));
      } catch {
        // Silent — a stale badge self-heals on next page mount.
      }
    }
    if (n.job_id) openJobDrawer(n.job_id);
  }

  async function markAllRead() {
    if (unreadCount === 0) return;
    setBusy(true); setOpErr(null);
    const snapshot = items;
    setItems((curr) => curr.map((n) => ({ ...n, is_read: true })));
    try {
      await api.patch('/notices/read', {});
      window.dispatchEvent(new CustomEvent('notices:invalidate'));
    } catch (e) {
      setItems(snapshot);
      setOpErr(e instanceof ApiError ? e.message : 'Could not mark all as read.');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setUnreadOnly((v) => !v)}
          className={cn(
            'px-2.5 py-1 text-xs font-semibold rounded-full border transition',
            unreadOnly
              ? 'border-primary bg-primary-50 text-primary'
              : 'border-ink-100 text-ink-500 hover:text-ink-900'
          )}
        >
          {unreadOnly ? `Unread (${unreadCount})` : 'Show unread only'}
        </button>
        <button
          type="button"
          onClick={markAllRead}
          disabled={busy || unreadCount === 0}
          className="px-3 py-2 text-sm font-semibold rounded-lg border border-ink-100 bg-surface hover:bg-ink-50 inline-flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
          title={unreadCount === 0 ? 'Nothing to mark' : `Mark ${unreadCount} as read`}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4 text-success" />}
          Mark all as read
        </button>
      </div>

      {opErr && <ErrorBanner text={opErr} />}

      {loading ? (
        <LoadingPanel text="Loading job updates…" />
      ) : error ? (
        <ErrorPanel text={error} />
      ) : visible.length === 0 ? (
        <EmptyPanel
          icon={Briefcase}
          title={unreadOnly ? 'All caught up' : 'No job updates yet'}
          sub={unreadOnly
            ? "You've read every update. We'll let you know when there's something new."
            : "When a job is assigned, completed, or needs your attention — like a material request — it will land here."}
        />
      ) : (
        <ul className="bg-surface rounded-2xl shadow-sm ring-1 ring-ink-100 divide-y divide-ink-100 overflow-hidden">
          {visible.map((n) => (
            <li key={n.notice_id}>
              <button
                type="button"
                onClick={() => void openNotice(n)}
                className={cn(
                  'w-full text-left px-4 py-3 flex items-start gap-3 transition',
                  n.is_read ? 'hover:bg-ink-50' : 'bg-warning-tint/40 hover:bg-warning-tint'
                )}
              >
                <Briefcase className="w-4 h-4 mt-0.5 shrink-0 text-ink-300" aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className={cn(
                      'text-sm leading-snug',
                      n.is_read ? 'font-semibold text-ink-700' : 'font-semibold text-ink-900'
                    )}>
                      {n.title}
                    </h3>
                    <span className="shrink-0 text-xs text-ink-300">{timeAgo(n.created_at)}</span>
                  </div>
                  {n.message && (
                    <p className="mt-1 text-sm text-ink-500 whitespace-pre-wrap">{n.message}</p>
                  )}
                  {n.job_id && (
                    <span className="mt-1 inline-block text-xs text-primary font-medium">
                      Job #{n.job_id} — tap to open
                    </span>
                  )}
                </div>
                {!n.is_read && <span className="w-2 h-2 mt-1.5 rounded-full bg-primary shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Announcements (GET /notice-board) ──────────────────────────────── */

type AnnouncementTab = 'all' | 'unread' | 'pinned';

function AnnouncementsFeed({
  items, setItems, loading, error,
}: {
  items: Announcement[];
  setItems: Dispatch<SetStateAction<Announcement[]>>;
  loading: boolean;
  error: string | null;
}) {
  const [tab, setTab] = useState<AnnouncementTab>('all');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [opErr, setOpErr] = useState<string | null>(null);

  const counts = useMemo(() => ({
    all: items.length,
    unread: items.filter((n) => !n.is_read).length,
    pinned: items.filter((n) => Number(n.is_pinned) === 1).length,
  }), [items]);

  const visible = useMemo(() => {
    if (tab === 'unread') return items.filter((n) => !n.is_read);
    if (tab === 'pinned') return items.filter((n) => Number(n.is_pinned) === 1);
    return items;
  }, [items, tab]);

  async function toggleExpand(notice: Announcement) {
    const willOpen = !expanded.has(notice.notice_id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(notice.notice_id)) next.delete(notice.notice_id);
      else next.add(notice.notice_id);
      return next;
    });
    if (willOpen && !notice.is_read) {
      setItems((curr) => curr.map((n) => (n.notice_id === notice.notice_id ? { ...n, is_read: true } : n)));
      try {
        await api.patch(`/notices/${notice.notice_id}/read`, {});
      } catch {
        // Silent — re-opening will retry.
      }
    }
  }

  async function markAllRead() {
    if (counts.unread === 0) return;
    setBusy(true); setOpErr(null);
    const snapshot = items;
    setItems((curr) => curr.map((n) => ({ ...n, is_read: true })));
    try {
      await api.patch('/notices/read-all', {});
    } catch (e) {
      setItems(snapshot);
      setOpErr(e instanceof ApiError ? e.message : 'Could not mark all as read.');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          {(['all', 'unread', 'pinned'] as AnnouncementTab[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                'px-2.5 py-1 text-xs font-semibold rounded-full border transition inline-flex items-center gap-1',
                tab === k ? 'border-primary bg-primary-50 text-primary' : 'border-ink-100 text-ink-500 hover:text-ink-900'
              )}
            >
              {k === 'pinned' && <Pin className="w-3 h-3" />}
              {k === 'all' ? 'All' : k === 'unread' ? 'Unread' : 'Pinned'} ({counts[k]})
            </button>
          ))}
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

      {opErr && <ErrorBanner text={opErr} />}

      {loading ? (
        <LoadingPanel text="Loading announcements…" />
      ) : error ? (
        <ErrorPanel text={error} />
      ) : visible.length === 0 ? (
        <EmptyPanel
          icon={Megaphone}
          title={tab === 'unread' ? 'All caught up' : tab === 'pinned' ? 'No pinned announcements' : 'No announcements yet'}
          sub={tab === 'unread'
            ? "You've read every announcement. We'll let you know when there's something new."
            : 'When EasyFix or your client admin posts an announcement, it will land here.'}
        />
      ) : (
        <ul className="bg-surface rounded-2xl shadow-sm ring-1 ring-ink-100 divide-y divide-ink-100 overflow-hidden">
          {visible.map((n) => (
            <AnnouncementRow
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

function AnnouncementRow({
  notice, expanded, onToggle,
}: {
  notice: Announcement;
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
        <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: color }} />
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
          <p className={cn('mt-1 text-sm text-ink-500 whitespace-pre-wrap', !expanded && 'line-clamp-2')}>
            {notice.body}
          </p>
          {expanded && notice.images?.length > 0 && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {notice.images.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt="" className="w-full aspect-video object-cover rounded-md border border-ink-100" />
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
        {!notice.is_read && <span className="w-2 h-2 mt-1.5 rounded-full bg-primary shrink-0" />}
      </button>
    </li>
  );
}

/* ─── shared bits ─────────────────────────────────────────────────────── */

function LoadingPanel({ text }: { text: string }) {
  return (
    <div className="bg-surface rounded-2xl shadow-sm ring-1 ring-ink-100 p-10 text-center">
      <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" />
      <div className="mt-2 text-sm text-ink-500">{text}</div>
    </div>
  );
}

function ErrorPanel({ text }: { text: string }) {
  return (
    <div className="bg-danger-tint border border-danger/30 rounded-2xl p-6 text-center text-sm text-danger-text">
      {text}
    </div>
  );
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <div className="rounded-lg bg-danger-tint border border-danger/30 px-3 py-2 text-xs text-danger-text inline-flex items-center gap-2">
      <AlertCircle className="w-4 h-4 text-danger" />
      {text}
    </div>
  );
}

function EmptyPanel({ icon: Icon, title, sub }: { icon: typeof BellRing; title: string; sub: string }) {
  return (
    <div className="bg-surface rounded-2xl shadow-sm ring-1 ring-ink-100 p-10 text-center">
      <Icon className="w-10 h-10 mx-auto text-ink-300" />
      <h3 className="mt-3 text-sm font-semibold text-ink-700">{title}</h3>
      <p className="mt-1 text-xs text-ink-500 max-w-xs mx-auto">{sub}</p>
    </div>
  );
}

/*
 * Relative-time formatter. Falls through to a locale date past 14 days so an
 * old notice gets an absolute anchor instead of "342 days ago".
 */
function timeAgo(iso: string | null): string {
  if (!iso) return '';
  /*
   * parseIstDateTime, because this feeds ARITHMETIC, not just a render. Read
   * as browser-local from a zone behind IST, "now" lands in the future and
   * this ladder — unlike the CRM's relativeTime, which clamps — would print
   * a negative duration.
   */
  const d = parseIstDateTime(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  return formatIst(d, { day: '2-digit', month: 'short', year: 'numeric' }, { fallback: '' });
}
