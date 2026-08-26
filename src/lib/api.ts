/*
 * Thin wrapper around fetch for the Client SPOC portal.
 * Token: stored in `localStorage.client_auth_token` and sent as Bearer.
 * Backend mounts under /api/client/*; we use /api proxy via next rewrites.
 */
export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const TOKEN_KEY = 'client_auth_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (typeof window === 'undefined') return;
  if (t) window.localStorage.setItem(TOKEN_KEY, t);
  else window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`/api/client${path}`, { ...init, headers, credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new ApiError(body?.error || `HTTP ${res.status}`, res.status, body?.details);
  }
  return body?.data as T;
}

// All verbs accept an optional `init` (RequestInit) so callers can pass
// e.g. an AbortSignal — `useFetch` in @/lib/hooks relies on this to
// cancel in-flight requests when component deps change or unmount.
export const api = {
  get:    <T>(p: string,            init?: RequestInit) => request<T>(p, init),
  post:   <T>(p: string, body: any, init?: RequestInit) => request<T>(p, { ...init, method: 'POST',   body: JSON.stringify(body) }),
  put:    <T>(p: string, body: any, init?: RequestInit) => request<T>(p, { ...init, method: 'PUT',    body: JSON.stringify(body) }),
  patch:  <T>(p: string, body: any, init?: RequestInit) => request<T>(p, { ...init, method: 'PATCH',  body: JSON.stringify(body) }),
  delete: <T>(p: string,            init?: RequestInit) => request<T>(p, { ...init, method: 'DELETE' }),

  /*
   * Multipart POST. Separate from `post` because `request()` unconditionally
   * JSON.stringify's the body and sets Content-Type: application/json — both
   * of which are wrong for a file: the body becomes "[object FormData]" and
   * the missing multipart boundary makes the server reject it. Letting fetch
   * set Content-Type itself is what generates that boundary, so this path
   * must never set the header.
   */
  upload: async <T>(p: string, form: FormData): Promise<T> => {
    const token = getToken();
    const res = await fetch(`/api/client${p}`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success === false) {
      throw new ApiError(body?.error || `HTTP ${res.status}`, res.status, body?.details);
    }
    return body?.data as T;
  },

  /*
   * Authenticated file download. Sits here as the sibling of `upload` so the
   * two transfer directions read the same at a call site; the implementation
   * is downloadBlob(), declared below — one function, two names, never two
   * copies. Existing `downloadBlob(...)` imports keep working.
   */
  download: (p: string, filename: string): Promise<DownloadResult> => downloadBlob(p, filename),
};

/*
 * Hand a blob to the browser as a file.
 *
 * Two details here are load-bearing, and every hand-rolled copy in this app
 * got at least one of them wrong before they were folded in here:
 *
 *   1. THE ANCHOR MUST BE IN THE DOCUMENT. Firefox ignores .click() on a
 *      detached <a>, so the download silently does nothing. downloadBlob()
 *      omitted the appendChild, which meant /export and Order History were
 *      broken on Firefox while the two copies that had it worked.
 *   2. REVOKE ON A LATER TICK. Revoking the object URL synchronously after
 *      .click() can cancel the save before the browser has finished reading
 *      the blob. The Contacts template download revoked immediately.
 *
 * Exported because a caller that BUILDS a blob locally (the invoices CSV) needs
 * the save half without the fetch half.
 */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Fetch an authenticated endpoint and save the response as a file.
// Also reachable as `api.download` — same function, named there for symmetry
// with the other verbs.
//
// Handles three response shapes:
//   1. Binary OK   → save as a file (the happy path)
//   2. JSON error  → parse body, throw ApiError with the message
//   3. Other error → throw ApiError with the status
//
// The JSON-error path matters for the export endpoint specifically:
// when the filter returns zero rows, the backend responds with a 404
// + `{success:false, error:'No data ...'}` instead of streaming an
// empty .xlsx — caller catches the ApiError and surfaces the message.
/*
 * What a download reports back. `truncated` is the only field a caller has to
 * act on — a workbook that stopped at the server's row cap looks exactly like
 * a complete one once it is on disk, so the page has to say so.
 */
export type DownloadResult = { truncated: boolean; total: number; rowCap: number };

export async function downloadBlob(path: string, filename: string): Promise<DownloadResult> {
  const token = getToken();
  const res = await fetch(`/api/client${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: 'include',
  });
  // Detect JSON error responses before we treat the body as a binary
  // blob. Without this, the FE used to save the JSON envelope as a
  // ".xlsx" file — corrupting the download for the no-data case.
  const ct = res.headers.get('content-type') || '';
  if (!res.ok || ct.includes('application/json')) {
    let body: { error?: string; details?: unknown } = {};
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    throw new ApiError(body.error || `download failed (${res.status})`, res.status, body.details);
  }
  saveBlob(await res.blob(), filename);
  /*
   * Truncation arrives in headers because the body is a binary workbook with
   * nowhere to carry a caveat. These are only READABLE cross-origin because
   * the route lists them in Access-Control-Expose-Headers — if this ever
   * starts reporting `truncated: false` on a capped export, check that header
   * first, not this parser.
   *
   * Absent headers mean an older backend, and default to "not truncated":
   * a caveat nobody can substantiate is worse than none.
   */
  const num = (h: string) => Number(res.headers.get(h) || 0) || 0;
  return {
    truncated: res.headers.get('X-Export-Truncated') === '1',
    total: num('X-Export-Total'),
    rowCap: num('X-Export-Row-Cap'),
  };
}
