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
