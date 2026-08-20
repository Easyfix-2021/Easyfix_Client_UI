'use client';

/*
 * SPOC profile is fetched once by the (authed) layout and shared with
 * every page below via this context. Use `useSpoc()` inside any
 * authed page/component to read the current SPOC — the layout
 * guarantees it's non-null before rendering `children`, so callers
 * never need to handle a loading state.
 */
import { createContext, useContext } from 'react';

export type Spoc = {
  id: number;
  contact_name: string;
  client_id: number;
  email?: string;
  // client_name surfaced from tbl_client.client_name via findSpocById;
  // used by the sidebar to label the brand block with the actual
  // company name (e.g. "Decathlon"). Optional so older tokens without
  // the field don't crash the FE.
  client_name?: string | null;
  // client_logo_url comes from /me which resolves tbl_client.logo_id
  // through the shared resolveClientDocumentUrl helper. Rendered as
  // the primary brand in the sidebar (client-first, not platform-
  // first). Null when the client hasn't uploaded a logo yet.
  client_logo_url?: string | null;
};

export const SpocContext = createContext<Spoc | null>(null);

export function useSpoc(): Spoc {
  const spoc = useContext(SpocContext);
  if (!spoc) {
    throw new Error('useSpoc() must be used inside the (authed) layout');
  }
  return spoc;
}

/* ─── Access ───────────────────────────────────────────────────────
 *
 * The SPOC's effective surface grants, folded server-side from their role
 * and their tri-state override flags (see EasyFix_Backend
 * services/client-access.service.js). Delivered on the same /me response
 * the layout already makes, so it costs no extra round trip.
 *
 * Hiding a nav item the SPOC does not hold is a COURTESY, not a control —
 * every gated route is guarded independently on the server. Never treat a
 * hidden tab as the security boundary.
 */
export type Access = {
  role: 'store' | 'regional' | 'senior' | 'finance';
  roleId: number;
  roleName: string;
  /** True when this SPOC sees the whole client rather than their booking subtree. */
  allStores: boolean;
  /** Surfaces held, e.g. ['home','open','completed','invoicing']. */
  grants: string[];
  /*
   * True when this SPOC has NO role configured — not a role called "none", the
   * absence of one. The portal shows it in red so it reads as a gap for an
   * administrator to close, rather than as a choice somebody made.
   *
   * What it grants is the SERVER's decision (see UNASSIGNED_FAILS_OPEN in
   * client-access.service.js), which during the rollout window is every
   * surface. The client must not infer access from this flag — always read
   * `grants`.
   */
  unassigned?: boolean;
};

/*
 * Fallback used when /me returns NO `access` key at all — i.e. a backend that
 * predates the access model, during a frontend-first deploy.
 *
 * This deliberately MIRRORS the server's LEGACY_GRANTS rather than being the
 * strictest possible set. If it withheld `invoicing`, shipping this frontend
 * before its backend would make the Invoices item vanish for every SPOC until
 * the two deploys met — a visible regression caused purely by deploy order.
 *
 * It is not a hole: it grants only what the portal already showed everyone
 * before roles existed, and it still withholds `performance`, which is new.
 * Once the backend responds with `access`, that payload always wins.
 */
export const LEGACY_ACCESS: Access = {
  role: 'store',
  roleId: 1,
  roleName: 'Store SPOC',
  allStores: false,
  grants: ['home', 'open', 'completed', 'actions', 'invoicing'],
};

/**
 * @deprecated Kept as an alias so existing imports keep compiling. New code
 * should name LEGACY_ACCESS, which says what the value actually is.
 */
export const LEAST_PRIVILEGE = LEGACY_ACCESS;

export const AccessContext = createContext<Access>(LEGACY_ACCESS);

export function useAccess(): Access {
  return useContext(AccessContext);
}

/** True when the current SPOC holds `surface`. */
export function useHasGrant(surface: string): boolean {
  return useAccess().grants.includes(surface);
}
