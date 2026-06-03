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
  History,
  Ticket,
  Clock4,
  CalendarCheck,
  MapPin,
  ClipboardCheck,
  ReceiptText,
  Users,
  HardHat,
  ExternalLink,
  LogOut,
  Bell,
  Menu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/confirm-dialog';

type NavItem = {
  href?: string;
  externalHref?: string;
  label: string;
  icon: typeof History;
  match?: string[];
};

const SECTION_ONE: NavItem[] = [
  { href: '/dashboard',           label: 'History',                 icon: History, match: ['/jobs'] },
  { href: '/tickets/new',         label: 'New Tickets',             icon: Ticket },
  { href: '/tickets/approvals',   label: 'Client Delay',            icon: Clock4 },
  { href: '/appointments',        label: 'Committed Appointments',  icon: CalendarCheck },
  { href: '/tx-location',         label: 'Tx on Location',          icon: MapPin },
  { href: '/tickets/under-audit', label: 'Completed & Under Audit', icon: ClipboardCheck },
  { href: '/ratecard',            label: 'Ratecard',                icon: ReceiptText },
];

const SECTION_TWO: NavItem[] = [
  { href: '/team',         label: 'My Team',         icon: Users },
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
        setSpoc(res.spoc);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setToken(null); router.push('/');
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

  const initials = initialsOf(spoc?.contact_name);

  return (
    <SpocContext.Provider value={spoc}>
    <div className="min-h-screen bg-slate-50">
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
          sidebarOpen ? 'w-64' : 'w-0 md:w-16 overflow-hidden'
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
          <div className="px-4 py-5 flex flex-col items-center gap-2.5 border-b border-white/15 text-center">
            <div
              className="bg-white rounded-xl p-2 shadow-md w-20 h-20 grid place-items-center overflow-hidden"
              title={`Client #${spoc?.client_id ?? '—'}`}
            >
              {spoc?.client_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={spoc.client_logo_url}
                  alt={spoc?.client_name || 'Client logo'}
                  className="max-w-full max-h-full object-contain"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <span className="text-primary font-extrabold text-2xl tracking-tight">
                  {(spoc?.client_name || 'EF').slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div className="text-base font-bold text-white leading-tight truncate max-w-full">
              {spoc?.client_name || 'Client Portal'}
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/70 font-semibold">
              Service Portal
            </div>
          </div>
        ) : (
          <div className="py-4 flex items-center justify-center border-b border-white/15">
            <div
              className="w-10 h-10 bg-white rounded-md flex items-center justify-center overflow-hidden p-1"
              title={`${spoc?.client_name || 'EasyFix'} · Client #${spoc?.client_id ?? '—'}`}
              aria-label={spoc?.client_name || 'Client'}
            >
              {spoc?.client_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={spoc.client_logo_url}
                  alt={spoc?.client_name || 'Client logo'}
                  className="max-w-full max-h-full object-contain"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <span className="text-primary font-extrabold text-sm tracking-tight">
                  {(spoc?.client_name || 'EF').slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
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
        sidebarOpen ? 'md:ml-64' : 'ml-0 md:ml-16'
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
            <button
              type="button"
              aria-label="Notifications"
              className="relative p-2 rounded hover:bg-slate-100 text-slate-700"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 inline-flex h-2 w-2 rounded-full bg-primary" />
            </button>

            <Link
              href="/profile"
              className="flex items-center gap-2 hover:opacity-90"
              aria-label="Open profile"
            >
              <span className="w-9 h-9 rounded-full bg-primary text-white font-bold flex items-center justify-center text-sm ring-2 ring-primary/20">
                {initials}
              </span>
              <span className="hidden md:block text-sm leading-tight">
                <span className="block font-semibold text-slate-800 truncate max-w-[160px]">
                  {spoc?.contact_name ?? 'User'}
                </span>
                <span className="block text-xs text-slate-500 truncate max-w-[160px]">
                  {spoc?.email ?? `Client #${spoc?.client_id ?? '—'}`}
                </span>
              </span>
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
        message={`You'll be returned to the sign-in screen. ${spoc?.contact_name ? `See you soon, ${spoc.contact_name.split(' ')[0]}.` : ''}`}
        confirmLabel="Sign out"
        cancelLabel="Cancel"
        tone="primary"
        busy={loggingOut}
        icon={LogOut}
      />
    </div>
    </SpocContext.Provider>
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
