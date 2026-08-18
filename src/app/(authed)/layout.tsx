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
import { SpocContext, type Spoc } from '@/lib/spoc-context';
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
  // Users, // used by the My Team nav item (currently removed)
  HardHat,
  Wallet,
  ExternalLink,
  LogOut,
  Bell,
  Menu,
  Smartphone,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { GetAppModal } from '@/components/get-app-modal';
import { JobDrawerHost } from '@/components/job-drawer';

type NavItem = {
  href?: string;
  externalHref?: string;
  label: string;
  icon: typeof History;
  match?: string[];
};

// Section 1 — operational workflow items the SPOC works through daily.
// Ratecard moved OUT to section 2 so the divider line falls ABOVE it,
// grouping the "reference / admin" entries together at the bottom.
//
// Home (Summary Dashboard) is the post-login landing page. Order
// History was split out from /dashboard into its own /history route
// when the Summary was introduced — kept right after Home so the
// SPOC's mental model "Home → drill into details" stays intact.
const SECTION_ONE: NavItem[] = [
  { href: '/dashboard',           label: 'Overview',                icon: Home },
  { href: '/history',             label: 'Order History',           icon: History, match: ['/jobs'] },
  { href: '/tickets/new',         label: 'New Tickets',             icon: Ticket },
  // Hidden for now (pages replaced with "Coming soon"; originals in git).
  // { href: '/tickets/approvals',   label: 'Client Delay',            icon: Clock4 },
  // { href: '/appointments',        label: 'Committed Appointments',  icon: CalendarCheck },
  // { href: '/tx-location',         label: 'Tx on Location',          icon: MapPin },
  // { href: '/tickets/under-audit', label: 'Completed & Under Audit', icon: ClipboardCheck },
];

const SECTION_TWO: NavItem[] = [
  { href: '/wallet',       label: 'Wallet',          icon: Wallet },
  { href: '/invoices',     label: 'Invoices',        icon: FileText },
  { href: '/ratecard',     label: 'Ratecard',        icon: ReceiptText },
  // My Team — removed from the sidebar (page + route still exist at /team).
  // { href: '/team',         label: 'My Team',         icon: Users },
  { href: '/technicians',  label: 'My Technicians',  icon: HardHat },
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
  const [loading, setLoading] = useState(true);
  // Set when /me fails for a reason OTHER than 401 (e.g. backend down,
  // network blip). Drives the "Try again" screen below instead of
  // letting a null SPOC reach useSpoc() and crash the whole dashboard.
  const [bootError, setBootError] = useState<string | null>(null);
  // Default sidebar OPEN on desktop, CLOSED on mobile.
  // We can't read window at SSR/render time, so initialise to true and
  // immediately collapse on first client mount if the viewport is below
  // the `md` breakpoint (768px). Prevents the 256px-wide sidebar from
  // hiding the hamburger toggle on phones.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, []);
  // Auto-close the sidebar after a nav click on mobile so the SPOC
  // sees the new page without a tap on the backdrop.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, [pathname]);
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
        const res = await api.get<{ spoc: Spoc }>('/me');
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
      <main className="min-h-screen flex items-center justify-center text-slate-500">
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
          <h1 className="text-lg font-bold text-slate-900">Couldn’t load your dashboard</h1>
          <p className="mt-1 text-sm text-slate-500 max-w-sm">
            {bootError || 'Your session could not be loaded right now.'}
          </p>
        </div>
        <button type="button" onClick={() => window.location.reload()} className="btn-primary">
          Try again
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
    <div className="min-h-screen bg-slate-50">
      {/* Mobile backdrop — only when sidebar is open and viewport is
          below md (768px). Tap to close. Pointer-events-none on desktop
          so it never blocks anything there. */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm md:hidden"
        />
      )}
      {/* Sidebar — fixed on every breakpoint so it stays visible while
          the main column scrolls. Mobile keeps the overlay behaviour
          (no margin push); desktop pushes the main column right via
          ml-16 / ml-64 below to make room for the fixed sidebar. */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col transition-all duration-200',
          // Warm brand-red gradient — keeps EasyFix's friendly identity
          // front and centre. Subtle multi-stop gradient instead of a
          // flat saturated red so the column has depth + reads as
          // polished, not screaming.
          'bg-gradient-to-b from-[#d9212b] via-[#b91c1c] to-[#7f1d1d] text-white shadow-2xl',
          sidebarOpen ? 'w-60' : 'w-0 md:w-16 overflow-hidden'
        )}
      >
        {/* Brand block — CLIENT brand first (their logo + company name).
            Reads as a client portal, not an internal ops console. The
            client_id is tucked into the logo tile's title attribute so
            ops can still recover it via hover for debugging but SPOCs
            see only their own company.
            Collapsed mode shrinks to a square logo tile (falls back to
            the company's initials when no logo is on file). */}
        {sidebarOpen ? (
          /* Compact brand block — 14px tile + tighter padding so the
             expanded sidebar fits all 10 nav items + powered-by footer
             without scrolling on a 720px viewport. */
          <div className="px-3 py-3 flex flex-col items-center gap-1.5 border-b border-white/15 text-center">
            <ClientLogoTile
              url={spoc?.client_logo_url}
              name={spoc?.client_name}
              clientId={spoc?.client_id}
              size="lg"
            />
            <div className="text-sm font-bold text-white leading-tight truncate max-w-full">
              {spoc?.client_name || 'Client Portal'}
            </div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-white/70 font-semibold">
              Service Portal
            </div>
          </div>
        ) : (
          <div className="py-4 flex items-center justify-center border-b border-white/15">
            <ClientLogoTile
              url={spoc?.client_logo_url}
              name={spoc?.client_name}
              clientId={spoc?.client_id}
              size="sm"
            />
          </div>
        )}

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {SECTION_ONE.map((item) => (
            <SidebarLink key={item.label} item={item} active={isActive(item)} collapsed={!sidebarOpen} />
          ))}

          <div className="my-3 border-t border-white/15" />

          {SECTION_TWO.map((item) => (
            <SidebarLink key={item.label} item={item} active={isActive(item)} collapsed={!sidebarOpen} />
          ))}
        </nav>

        {/* "powered by EasyFix" footer — bold white wordmark against the
            red sidebar so the attribution stays legible. */}
        {sidebarOpen && (
          <div className="px-4 py-3 border-t border-white/15 flex items-center justify-center gap-1.5">
            <span className="text-[10px] text-white/60 uppercase tracking-wider">powered by</span>
            <span className="text-xs font-extrabold text-white tracking-tight">
              EasyFix
            </span>
          </div>
        )}
      </aside>

      {/* Main column: navbar + content.
          Left margin matches sidebar width on desktop so content
          doesn't sit under the fixed sidebar. Mobile keeps ml-0 since
          the sidebar overlays instead of pushing. */}
      <div className={cn(
        'flex flex-col min-w-0 transition-[margin] duration-200',
        sidebarOpen ? 'md:ml-60' : 'ml-0 md:ml-16'
      )}>
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 flex items-center px-4 md:px-6 gap-4">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle sidebar"
            className="p-2 rounded hover:bg-slate-100 text-slate-700"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="ml-auto flex items-center gap-3 md:gap-5">
            {/* Get the App — reopens the mobile-app promo any time. */}
            <button
              type="button"
              onClick={() => setAppModalOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-primary bg-primary-50 ring-1 ring-primary/20 hover:bg-primary-100 transition"
            >
              <Smartphone className="w-3.5 h-3.5" /> Get the App
            </button>
            {/* Notification bell — amber/gold treatment matching the
                target mock. Soft amber tile background, deep amber
                stroke + matching fill so the bell reads as gold; red
                indicator dot stays brand-rose for instant
                "unread" recognition. */}
            {/* Notifications bell → /notifications. The count comes from
                the unread-count poll above (initial fetch + 60s tick,
                plus an event-driven refresh when the notifications
                page mutates read state). Hides the badge when zero so
                an idle inbox doesn't show a stale "0" pill. */}
            <Link
              href="/notifications"
              aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
              className="relative p-2 rounded-full bg-amber-50 hover:bg-amber-100 ring-1 ring-amber-200 transition"
            >
              <Bell
                className="w-5 h-5 text-amber-500"
                strokeWidth={2}
                fill="#FBBF24"
              />
              {unread > 0 && (
                // Numeric badge when there's a count; collapses to a
                // bare dot for 1-digit counts to keep the bell compact.
                // Caps at 99+ so two-digit counts don't break the layout.
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-500 ring-2 ring-white text-[10px] font-bold text-white leading-none">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>

            {/* Profile chip — pill with pink→violet gradient avatar,
                first name, and a chevron. Links to the profile page. */}
            <Link
              href="/profile"
              className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-50 transition"
              aria-label="Open profile"
            >
              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-fuchsia-400 via-pink-500 to-violet-600 text-white font-extrabold flex items-center justify-center text-xs">
                {initials}
              </span>
              <span className="hidden sm:block leading-tight text-left">
                <span className="block text-sm font-bold text-slate-900 truncate max-w-[140px]">
                  {firstName}
                </span>
                <span className="block text-[11px] text-slate-500">
                  Client #{spoc?.client_id ?? '—'}
                </span>
              </span>
              <ChevronDown className="w-4 h-4 text-slate-400 hidden sm:block" />
            </Link>

            <button
              type="button"
              onClick={() => setLogoutOpen(true)}
              aria-label="Logout"
              title="Logout"
              className="p-2 rounded hover:bg-primary-50 text-slate-700 hover:text-primary transition"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">{children}</main>
      </div>

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
    </SpocContext.Provider>
  );
}

/*
 * ClientLogoTile — sidebar brand block tile.
 *
 * Prefers the actual client logo image (Nginx-served URL from
 * `spoc.client_logo_url`). If the image fails to load (404, CORS,
 * file removed, etc.), flips to a `broken` state and renders the
 * client's INITIALS — same fallback we use when no logo is on file.
 * Avoids the "blank white square" failure mode the previous inline
 * onError → hide handler was causing.
 *
 * Two sizes:
 *   "lg" → 80×80 rounded-xl tile for the expanded sidebar.
 *   "sm" → 40×40 rounded-md tile for the collapsed rail.
 */
function ClientLogoTile({
  url, name, clientId, size,
}: {
  url?: string | null;
  name?: string | null;
  clientId?: number | null;
  size: 'lg' | 'sm';
}) {
  const [broken, setBroken] = useState(false);
  const initials = (name || 'EF').slice(0, 2).toUpperCase();
  const titleAttr = size === 'lg'
    ? `Client #${clientId ?? '—'}`
    : `${name || 'EasyFix'} · Client #${clientId ?? '—'}`;

  // lg shrunk from 80px → 56px so the whole nav fits without scroll on
  // a standard 720-768px screen. sm collapsed-rail size unchanged.
  const tileClass = size === 'lg'
    ? 'bg-white rounded-lg p-1.5 shadow-md w-14 h-14 grid place-items-center overflow-hidden'
    : 'w-10 h-10 bg-white rounded-md flex items-center justify-center overflow-hidden p-1';
  const initialsClass = size === 'lg'
    ? 'text-primary font-extrabold text-lg tracking-tight'
    : 'text-primary font-extrabold text-sm tracking-tight';

  return (
    <div className={tileClass} title={titleAttr} aria-label={name || 'Client'}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name || 'Client logo'}
          className="max-w-full max-h-full object-contain"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className={initialsClass}>{initials}</span>
      )}
    </div>
  );
}

function SidebarLink({
  item, active, collapsed,
}: { item: NavItem; active: boolean; collapsed: boolean }) {
  const Icon = item.icon;

  const className = cn(
    'flex items-center gap-3 px-3 py-2 rounded text-sm transition',
    active
      ? 'bg-white text-primary font-semibold shadow-sm'
      : 'text-white/90 hover:bg-white/10 hover:text-white'
  );

  if (item.externalHref) {
    return (
      <a
        href={item.externalHref}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        title={collapsed ? item.label : undefined}
      >
        <Icon className="w-4 h-4 shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </a>
    );
  }

  return (
    <Link
      href={item.href!}
      className={className}
      title={collapsed ? item.label : undefined}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}
