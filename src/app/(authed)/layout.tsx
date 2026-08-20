'use client';

/*
 * Authed shell — red/white theme, replicates the legacy
 * Angular_ClientDashboard sidebar (2 sections, 11 menu items) plus a
 * top navbar with notifications and user avatar.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, getToken, setToken } from '@/lib/api';
import { SpocContext, AccessContext, LEGACY_ACCESS, type Spoc, type Access } from '@/lib/spoc-context';
import {
  Home,
  History,
  Ticket,
  Clock4,
  CalendarCheck,
  MapPin,
  ClipboardCheck,
  ReceiptText,
  FileText,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
  Users,
  HardHat,
  TrendingUp,
  Wallet,
  ExternalLink,
  LogOut,
  Bell,
  Smartphone,
  ChevronDown,
  MoreHorizontal,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { GetAppModal } from '@/components/get-app-modal';
import { JobDrawerHost } from '@/components/job-drawer';
import { Logo } from '@/components/brand/logo';
import { FilterChip } from '@/components/ui/console';

type NavItem = {
  href?: string;
  externalHref?: string;
  label: string;
  icon: typeof History;
  match?: string[];
  /*
   * Surface this item requires, matched against the SPOC's grants from
   * /me. Undefined = always shown. Hiding is a courtesy; the route itself
   * is guarded server-side, so a hidden item is not the security boundary.
   */
  grant?: string;
  /*
   * Which live count to hang off this tab, if any. The tab does NOT fetch —
   * the shell already polls these, and a tab that fetches its own badge is a
   * request per tab on every navigation.
   */
  badge?: 'open' | 'actions';
};

/*
 * ── The tab row ──────────────────────────────────────────────────────────
 *
 * PRIMARY is the destination set from the client team's design: the seven
 * places a SPOC actually works. EXTRAS is everything else the portal still
 * does — real, live pages that simply are not part of that design.
 *
 * They are not deleted and they are not crammed into the row. Nine peers in a
 * horizontal nav is a row nobody scans; instead the long tail collapses behind
 * one "Extras" tab that opens on hover or focus. The cost of a menu is that it
 * hides where you can go, which is why only the tail goes in it — never a
 * destination someone visits daily.
 *
 * Order History sits in EXTRAS rather than PRIMARY because "Open jobs" and
 * "Completed" together cover the same ground, split the way the design splits
 * it. The page is untouched and one hover away.
 */
const PRIMARY: NavItem[] = [
  { href: '/dashboard',   label: 'Home',            icon: Home },
  { href: '/jobs',        label: 'Open jobs',       icon: FolderOpen, badge: 'open' },
  { href: '/completed',   label: 'Completed',       icon: CheckCircle2 },
  // Gated on can_view_performance. Absent for every existing SPOC until an
  // administrator turns it on — see EasyFix_Backend/migrations/2026-08-20-client-spoc-access.sql.
  { href: '/performance', label: 'Performance',     icon: TrendingUp, grant: 'performance' },
  { href: '/action-queue', label: 'My action queue', icon: AlertTriangle, badge: 'actions' },
  { href: '/invoices',    label: 'Invoicing',       icon: FileText, grant: 'invoicing' },
  { href: '/analytics',   label: 'Analytics',       icon: BarChart3 },
  { href: '/stores',      label: 'Store SPOC view', icon: Users },
];

/*
 * The header's capability chips. Deliberately COARSER than the tab row: a tab
 * is a destination, a chip is an area of responsibility, and collapsing
 * home/open/completed/actions into one "Operations" chip is what keeps the two
 * rows from reading as the same list twice.
 *
 * `grant: undefined` means the area needs no grant — every SPOC has operations.
 */
const AREAS: Array<{ label: string; href: string; match: string[]; grant?: string }> = [
  { label: 'Operations',  href: '/dashboard',   match: ['/dashboard', '/jobs', '/completed', '/action-queue', '/history', '/tickets'] },
  { label: 'Performance', href: '/performance', match: ['/performance'], grant: 'performance' },
  { label: 'Invoicing',   href: '/invoices',    match: ['/invoices', '/wallet'], grant: 'invoicing' },
];

const EXTRAS: NavItem[] = [
  { href: '/history',     label: 'Order History',  icon: History },
  { href: '/tickets/new', label: 'New Tickets',    icon: Ticket },
  { href: '/wallet',      label: 'Wallet',         icon: Wallet },
  { href: '/ratecard',    label: 'Ratecard',       icon: ReceiptText },
  { href: '/technicians', label: 'My Technicians', icon: HardHat },
  { externalHref: 'https://www.easyfix.in/our-team', label: 'Contact Us', icon: ExternalLink },
];


function initialsOf(name?: string) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [spoc, setSpoc] = useState<Spoc | null>(null);
  /*
   * Effective grants, delivered on the same /me response.
   *
   * Seeded with LEGACY_ACCESS — what the portal showed everyone before roles
   * existed. That keeps a frontend-first deploy from hiding Invoices, while
   * still withholding the new Performance screen. The server's payload
   * replaces this the moment /me resolves.
   */
  const [access, setAccess] = useState<Access>(LEGACY_ACCESS);
  const [loading, setLoading] = useState(true);
  // Set when /me fails for a reason OTHER than 401 (e.g. backend down,
  // network blip). Drives the "Try Again" screen below instead of
  // letting a null SPOC reach useSpoc() and crash the whole dashboard.
  const [bootError, setBootError] = useState<string | null>(null);
  const bootedRef = useRef(false);

  useEffect(() => {
    // Guard against React 18 Strict Mode's dev-only double-effect-invocation
    // (refs persist across the simulated unmount/remount cycle, so this
    // becomes a true once-per-mount fetch).
    if (bootedRef.current) return;
    bootedRef.current = true;

    if (!getToken()) { router.push('/'); return; }
    (async () => {
      try {
        const res = await api.get<{ spoc: Spoc; access?: Access }>('/me');
        // A backend that predates the access model returns no `access` key,
        // in which case LEGACY_ACCESS stands and the portal looks exactly as
        // it did before roles existed.
        if (res?.access) setAccess(res.access);
        if (res?.spoc) setSpoc(res.spoc);
        else setBootError('We could not load your profile. Please try again.');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setToken(null); router.push('/');
        } else {
          // Backend down / network blip — don't render children with a
          // null SPOC (that crashes useSpoc). Show a retry screen instead.
          setBootError(
            err instanceof ApiError
              ? err.message
              : 'Could not reach the server. Check your connection and try again.'
          );
        }
      } finally { setLoading(false); }
    })();
  }, [router]);

  // ─── Logout flow ────────────────────────────────────────────────────
  // Two-step: clicking the icon opens a confirmation dialog (legacy
  // parity — LogoutDialogComponent on the Angular dashboard); confirming
  // calls the API, wipes the token + any cached SPOC state, and
  // redirects to the public landing page.
  //
  // The fetch can fail (offline / backend down) but we STILL clear local
  // state and redirect — staying on the dashboard with no working
  // session is a worse failure mode than the cookie surviving server-side
  // (it'll expire on its own; tokens are stateless JWTs).
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // ─── "Get the App" promo ───────────────────────────────────────────
  // Auto-open ONCE per browser after the first login (gated on a
  // localStorage flag so it never nags), and re-openable any time from
  // the "Get the App" button in the top bar.
  const [appModalOpen, setAppModalOpen] = useState(false);
  useEffect(() => {
    if (!spoc) return;
    try {
      if (!localStorage.getItem('ef_app_promo_seen')) setAppModalOpen(true);
    } catch { /* localStorage unavailable — just skip the auto-open */ }
  }, [spoc]);
  function closeAppModal() {
    setAppModalOpen(false);
    try { localStorage.setItem('ef_app_promo_seen', '1'); } catch { /* ignore */ }
  }

  /*
   * ─── Tab badges ────────────────────────────────────────────────────
   * The counts on "Open jobs" and "My action queue".
   *
   * Fetched HERE, once, rather than by each tab: the shell renders on every
   * route, so a tab that fetched its own badge would fire a request per tab on
   * every navigation. Both are advisory — a failed fetch simply leaves the tab
   * unbadged, never blocks the nav, and never shows a stale zero (the badge is
   * hidden at 0 rather than rendered as "0").
   *
   * Refreshed on the same `jobs:invalidate` event the job drawer already emits
   * after a mutation, so approving an estimate drops the queue count at once
   * instead of on the next full page load.
   */
  const [openCount, setOpenCount] = useState<number | undefined>(undefined);
  const [actionCount, setActionCount] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!spoc) return;
    let cancelled = false;
    async function refreshCounts() {
      try {
        const [orders, queue] = await Promise.allSettled([
          api.get<{ otherOrders: number }>('/orders/counts'),
          api.get<{ total: number }>('/action-queue'),
        ]);
        if (cancelled) return;
        if (orders.status === 'fulfilled') setOpenCount(Number(orders.value?.otherOrders) || 0);
        if (queue.status === 'fulfilled') setActionCount(Number(queue.value?.total) || 0);
      } catch { /* advisory only */ }
    }
    refreshCounts();
    window.addEventListener('jobs:invalidate', refreshCounts);
    return () => {
      cancelled = true;
      window.removeEventListener('jobs:invalidate', refreshCounts);
    };
  }, [spoc]);

  // ─── Unread-notice count for the bell badge ────────────────────────
  // Polled once on mount + every 60s while the tab is foregrounded.
  // We deliberately avoid SSE/WebSockets here — a single GET every
  // minute is a few hundred bytes and saves us a long-lived connection.
  // The /notifications page itself triggers an immediate refresh via
  // a `window`-level event (see refreshUnread below) so a "Mark all as
  // read" tap doesn't have to wait up to 60s for the bell to clear.
  const [unread, setUnread] = useState<number>(0);
  useEffect(() => {
    if (!spoc) return;
    let cancelled = false;
    async function refreshUnread() {
      try {
        const r = await api.get<{ count: number }>('/notices/unread-count');
        if (!cancelled) setUnread(Number(r?.count) || 0);
      } catch {
        // Silent — the badge just won't update. Avoid spamming the
        // console on an offline laptop.
      }
    }
    refreshUnread();
    // Poll every 60s, but SKIP the request while the tab is hidden — a
    // backgrounded tab doesn't need a live badge, and at scale this saves
    // N-users × one needless request per minute. Refreshes the instant the
    // tab regains focus.
    const tick = () => { if (!document.hidden) refreshUnread(); };
    const id = window.setInterval(tick, 60_000);
    function onVisible() { if (!document.hidden) refreshUnread(); }
    document.addEventListener('visibilitychange', onVisible);
    // Cross-component invalidation: pages that mutate read state
    // (e.g. /notifications "Mark all as read") dispatch this event
    // so the bell repaints instantly.
    function onInvalidate() { refreshUnread(); }
    window.addEventListener('notices:invalidate', onInvalidate);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('notices:invalidate', onInvalidate);
    };
  }, [spoc]);

  async function performLogout() {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* network failure is OK — token will expire stateless-style and
         the local cleanup below still happens. */
    }
    // Wipe every local trace of the session so a refresh can't reuse
    // the old token. setToken(null) clears localStorage.client_auth_token;
    // we also blow away the in-memory SPOC context.
    setToken(null);
    setSpoc(null);
    // Any other client-side caches the app accumulates should be torn
    // down here too. Currently only useFetchOnce holds path-keyed state,
    // and that lives inside unmounted route components — `router.push('/')`
    // unmounts them, so nothing to clear explicitly.
    router.push('/');
  }

  /*
   * Nav visibility. An item with no `grant` is always shown; one with a grant
   * appears only when the SPOC holds it. This mirrors the server guard rather
   * than replacing it — requireGrant() on the route is what actually denies.
   */
  const visible = useMemo(
    () => (item: NavItem) => !item.grant || access.grants.includes(item.grant),
    [access]
  );

  const isActive = useMemo(
    () => (item: NavItem) => {
      if (!item.href) return false;
      if (pathname === item.href) return true;
      if (pathname.startsWith(item.href + '/')) return true;
      if (item.match?.some((m) => pathname === m || pathname.startsWith(m + '/'))) return true;
      return false;
    },
    [pathname]
  );

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-ink-500">
        Loading…
      </main>
    );
  }

  // No SPOC after loading (and not a 401 redirect) → the /me call failed.
  // Render a friendly retry screen rather than letting a null SPOC reach
  // useSpoc() in the child pages and white-screen the whole dashboard.
  if (!spoc) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="w-14 h-14 rounded-full bg-primary-50 text-primary grid place-items-center ring-4 ring-primary/10">
          <Bell className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-ink-900">Couldn’t load your dashboard</h1>
          <p className="mt-1 text-sm text-ink-500 max-w-sm">
            {bootError || 'Your session could not be loaded right now.'}
          </p>
        </div>
        <button type="button" onClick={() => window.location.reload()} className="btn-primary">
          Try Again
        </button>
      </main>
    );
  }

  const initials = initialsOf(spoc?.contact_name);
  const firstName = (spoc?.contact_name || 'User')
    .replace(/^(mr|mrs|ms|dr|miss|sir|madam)\.?\s+/i, '')
    .trim().split(/\s+/)[0] || 'User';

  return (
    <SpocContext.Provider value={spoc}>
    <AccessContext.Provider value={access}>
    <div className="min-h-screen bg-surface-alt flex flex-col">
      {/*
        ── The console shell ────────────────────────────────────────────────
        Two stacked rows on a light ground, replacing the dark left sidebar:

          row 1  IDENTITY + ACCOUNT — "EasyFix / <client>" on the left, the
                 account cluster on the right.
          row 2  DESTINATIONS — every screen as a horizontal tab.

        WHY THE MASTHEAD IS NO LONGER DARK. The previous shell put a dark ink
        column down the left, and src/brand/tokens.ts still documents that
        treatment. The client team's design moves the chrome to the top and
        makes it light, which is a real improvement for this product rather
        than a preference: a fixed 240px column costs a quarter of the width on
        a 1280px laptop, and this console's content is wide — job tables,
        rate cards, month-by-month charts. Horizontal nav gives that width back.

        The `chrome-*` tokens are deliberately left defined in tokens.ts. They
        still describe a correct dark-on-light relationship, and the mobile
        drawer and any future dark surface should use them rather than
        reinventing one.
      */}
      <header className="sticky top-0 z-30 bg-surface border-b border-ink-100">
        <div className="h-14 px-4 md:px-6 flex items-center gap-3">
          {/*
            The brand lockup. EasyFix first, then the client — the portal is
            ours, operated for them, and that ordering is what the shared
            design shows ("EasyFix / Lenskart"). The mark comes from the one
            <Logo> owner so a rebrand stays a one-file change.
          */}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 shrink-0 min-w-0"
            aria-label="EasyFix client portal — go to Overview"
          >
            {/*
              The mark and the client name are set to the SAME optical size, as
              the design has them ("EasyFix / Lenskart" reads as one line, not a
              logo with a caption).

              h-4 against text-base is not a coincidence: the wordmark's viewBox
              spans ascender to DESCENDER (the 'y' in EasyFix), so its cap height
              is roughly 0.72 of the box. A 16px box therefore caps at ~11.5px,
              which is the cap height of 16px text. Matching the box to the font
              size instead would render the mark visibly larger.
            */}
            <Logo priority alt="" className="h-4 w-auto" />
            <span className="text-ink-300 select-none text-base" aria-hidden>/</span>
            <span className="text-base text-ink-900 truncate max-w-[8rem] sm:max-w-[12rem] md:max-w-[18rem]">
              {spoc?.client_name || 'Client Portal'}
            </span>
          </Link>


          {/*
            The header's capability chips — a read-out of the ACCESS MODEL,
            which the portal already resolves at boot from /me.

            These are the AREAS the caller holds: Operations is always held
            (home/open/completed are universal), while Performance and
            Invoicing appear only when the grant is actually present, so the
            row is an honest answer to "what am I allowed to see?".

            The ROLE deliberately is NOT one of these. A capability chip is a
            control — click it and you go there — while a role is a fact about
            the reader that they cannot change. Mixing the two put a dead chip
            in a row of live ones; the role now sits under the name in the
            profile block, where identity belongs.

            Clicking a capability jumps to that area, and the one matching the
            current route is tinted — the same active/resting treatment the
            tabs use, so the two rows agree. Hidden below `lg` where the tab
            strip already needs the width.
          */}
          <div className="hidden lg:flex items-center justify-center gap-1.5 flex-1 min-w-0">
            {AREAS.filter((a) => !a.grant || access.grants.includes(a.grant)).map((a) => (
              <FilterChip
                key={a.label}
                active={a.match.some((m) => pathname.startsWith(m))}
                onClick={() => router.push(a.href)}
              >
                {a.label}
              </FilterChip>
            ))}
          </div>
          <div className="ml-auto lg:ml-0 shrink-0 flex items-center gap-2 md:gap-3">
            <button
              type="button"
              onClick={() => setAppModalOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-primary bg-primary-50 ring-1 ring-primary/20 hover:bg-primary-100 transition"
            >
              <Smartphone className="w-3.5 h-3.5" /> Get the App
            </button>

            {/* Notifications → /notifications. Count comes from the unread poll
                (initial fetch + 60s tick + an event-driven refresh when the
                notifications page mutates read state). Badge hides at zero so an
                idle inbox never shows a stale "0". */}
            <Link
              href="/notifications"
              aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
              className="relative p-2 rounded-full bg-gold-tint hover:bg-gold/20 ring-1 ring-gold/30 transition"
            >
              <Bell className="w-5 h-5 text-gold" strokeWidth={2} fill="var(--ef-gold)" />
              {unread > 0 && (
                // Caps at 99+ so a three-digit count cannot stretch the pill.
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-primary ring-2 ring-white text-xs font-semibold text-white leading-none">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>

            <Link
              href="/profile"
              className="flex items-center gap-2 pl-1 pr-2 sm:pr-3 py-1 rounded-full border border-ink-100 bg-surface hover:bg-surface-alt transition"
              aria-label="Open profile"
            >
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-primary via-primary-600 to-primary-dark text-white font-semibold flex items-center justify-center text-xs">
                {initials}
              </span>
              <span className="hidden md:block leading-tight text-left">
                <span className="block text-sm font-semibold text-ink-900 truncate max-w-[140px]">{firstName}</span>
                {/*
                  Role over client id, under the name. Identity in one place:
                  who you are, what you are, and which client you are in.

                  "No Role" renders in danger red rather than the muted grey the
                  rest of this line uses — an unconfigured SPOC is a gap for an
                  administrator to close in CRM -> Manage Clients -> Contacts,
                  and at this size colour is the only thing that gets noticed.
                */}
                <span
                  className={cn(
                    'block text-xs truncate max-w-[140px]',
                    access.unassigned ? 'text-danger-text font-medium' : 'text-ink-500',
                  )}
                  title={access.unassigned
                    ? 'No role assigned yet — an administrator can set one in CRM > Manage Clients > Contacts'
                    : `Role: ${access.roleName}`}
                >
                  {access.roleName} · #{spoc?.client_id ?? '—'}
                </span>
              </span>
            </Link>

            <button
              type="button"
              onClick={() => setLogoutOpen(true)}
              aria-label="Logout"
              title="Logout"
              className="p-2 rounded hover:bg-primary-50 text-ink-700 hover:text-primary transition"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/*
          Destinations. One row, horizontally scrollable rather than collapsed
          into a hamburger: a menu that has to be opened hides where you can go,
          and this console has only nine places. Grant-gated tabs are filtered
          out entirely — the server still guards each route, so hiding a tab is
          a courtesy, not a control.
        */}
        {/*
          Destinations. The tab strip scrolls horizontally rather than
          collapsing into a hamburger — a menu that must be opened hides where
          you can go, and this console has few enough places to show them all.

          EXTRAS SITS OUTSIDE THE SCROLLER, and that is structural rather than
          cosmetic: `overflow-x-auto` establishes a scroll container, and a
          scroll container CLIPS its absolutely-positioned descendants in both
          axes. With the menu inside the nav its panel was cut off at the nav's
          bottom edge and read as "hiding under the page body". Lifting it into
          a sibling that never scrolls is the fix; raising z-index alone would
          not have helped, because clipping happens regardless of stacking.
        */}
        <div className="px-2 md:px-4 flex items-stretch">
          <nav
            aria-label="Primary"
            className="flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0"
          >
            {PRIMARY.filter(visible).map((item) => (
              <TabLink
                key={item.label}
                item={item}
                active={isActive(item)}
                count={item.badge === 'actions' ? actionCount : item.badge === 'open' ? openCount : undefined}
              />
            ))}
          </nav>
          <div className="shrink-0 flex items-center pl-1 ml-1 border-l border-ink-100">
            <ExtrasMenu items={EXTRAS.filter(visible)} activeHref={pathname} />
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 md:px-6 py-5 min-w-0">{children}</main>

      <ConfirmDialog
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={performLogout}
        title="Sign out?"
        message={`You'll be returned to the sign-in screen. ${spoc?.contact_name ? `See you soon, ${spoc.contact_name.trim()}.` : ''}`}
        confirmLabel="Sign out"
        cancelLabel="Cancel"
        tone="primary"
        busy={loggingOut}
        icon={LogOut}
      />

      <GetAppModal open={appModalOpen} onClose={closeAppModal} />

      {/* Global job details drawer — opens on any job-id click via openJobDrawer(). */}
      <JobDrawerHost />
    </div>
    </AccessContext.Provider>
    </SpocContext.Provider>
  );
}

function TabLink({ item, active, count }: { item: NavItem; active: boolean; count?: number }) {
  const Icon = item.icon;

  /*
   * The active marker is a RED UNDERLINE plus red copy.
   *
   * On the old dark chrome, brand red measured 3.00:1 and was legal only as a
   * shape, so the active item was white copy over a red rail. On this light
   * surface red-500 on white is 5.77:1 — it passes for normal text, so the
   * label itself carries the brand colour and the rule reinforces it. Inactive
   * labels sit at ink-500 and lift to ink-900 on hover, so the row feels live
   * before you commit to a click.
   */
  const className = cn(
    'inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm border-b-2 -mb-px transition',
    active
      ? 'border-primary text-primary font-semibold'
      : 'border-transparent text-ink-500 hover:text-ink-900 hover:border-ink-300',
  );

  const body = (
    <>
      <Icon className="w-4 h-4 shrink-0" aria-hidden />
      <span>{item.label}</span>
      {/* Hidden at zero rather than rendered as "0" — an empty queue should read
          as nothing to do, not as a metric worth a badge. */}
      {typeof count === 'number' && count > 0 && (
        <span className="ml-0.5 inline-flex items-center justify-center min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-primary-100 text-primary text-xs font-semibold tabular-nums">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </>
  );

  if (item.externalHref) {
    return (
      <a href={item.externalHref} target="_blank" rel="noopener noreferrer" className={className}>
        {body}
      </a>
    );
  }

  return (
    <Link href={item.href!} className={className} aria-current={active ? 'page' : undefined}>
      {body}
    </Link>
  );
}

/*
 * The long tail, behind one tab.
 *
 * Opens on HOVER and on FOCUS-WITHIN, and the trigger is a real <button> with
 * aria-haspopup — so it is reachable by keyboard and announced as a menu, which
 * a hover-only CSS dropdown is not. No JS state: open/close is `group-hover` +
 * `group-focus-within`, which cannot desynchronise from the pointer the way a
 * mouseenter/mouseleave pair can when the cursor leaves the window mid-gesture.
 *
 * `pt-1` on the panel rather than `mt-1` is deliberate: a margin would leave a
 * dead gap between trigger and menu, and the menu would close as the pointer
 * crossed it. Padding keeps the hover target continuous.
 */
function ExtrasMenu({ items, activeHref }: { items: NavItem[]; activeHref: string }) {
  if (!items.length) return null;
  const holdsActive = items.some((i) => i.href && activeHref.startsWith(i.href));

  return (
    <div className="relative group">
      <button
        type="button"
        aria-haspopup="menu"
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm border-b-2 -mb-px transition',
          holdsActive
            ? 'border-primary text-primary font-semibold'
            : 'border-transparent text-ink-500 hover:text-ink-900 hover:border-ink-300',
        )}
      >
        <MoreHorizontal className="w-4 h-4 shrink-0" aria-hidden />
        <span>Extras</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden />
      </button>

      <div role="menu" className="absolute right-0 top-full z-50 pt-1 hidden group-hover:block group-focus-within:block">
        <div className="min-w-[13rem] rounded-xl border border-ink-100 bg-surface shadow-lg py-1">
          {items.map((item) => {
            const Icon = item.icon;
            const active = !!item.href && activeHref.startsWith(item.href);
            const cls = cn(
              'flex items-center gap-2.5 px-3 py-2 text-sm transition',
              active ? 'text-primary font-semibold bg-primary-50' : 'text-ink-700 hover:bg-surface-alt',
            );
            return item.externalHref ? (
              <a key={item.label} role="menuitem" href={item.externalHref} target="_blank" rel="noopener noreferrer" className={cls}>
                <Icon className="w-4 h-4 shrink-0 text-ink-300" aria-hidden />
                {item.label}
              </a>
            ) : (
              <Link key={item.label} role="menuitem" href={item.href!} className={cls}>
                <Icon className="w-4 h-4 shrink-0 text-ink-300" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
