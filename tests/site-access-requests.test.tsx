/*
 * Site Access Requests — the four things that would fail silently.
 *
 *   1. THE PANEL APPEARS ON EVERY JOB. It is mounted on the job detail page and
 *      on the drawer, i.e. on every job in the estate. If the empty guard goes,
 *      a "Site Access" heading grows on thousands of jobs that have no request
 *      and people learn to scroll past the one panel that must be noticed.
 *
 *   2. THE WAITING CLOCK. `requestedAt` is a ZONE-LESS IST wall clock. Read with
 *      a plain `new Date(...)` on a non-IST browser it is off by hours, and
 *      "Waiting 5 hr" on a request raised eight minutes ago is worse than no
 *      number. A future stamp (phone/server clock skew) must say nothing rather
 *      than count backwards.
 *
 *   3. DECLINE IS GATED AND NEVER NATIVE. A technician gets turned away, so it
 *      needs a reason and this app's own confirm dialog — window.confirm is
 *      banned here and cannot be styled or tested.
 *
 *   4. THE DOCUMENT IS A PRESIGNED LINK. An <img>/<a> aimed at an authenticated
 *      portal endpoint 401s with NO visible error in this app, so the uploaded
 *      pass would appear to be missing. The href must be the presigned URL the
 *      row carries, verbatim.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setFetches, lookup } from './helpers/page-harness';

vi.mock('@/lib/hooks', () => ({
  useFetch: (p: string | null) => lookup(p),
  useFetchOnce: (p: string | null) => lookup(p),
  useDebouncedValue: (v: unknown) => v,
}));

const upload = vi.fn().mockResolvedValue({});
const post = vi.fn().mockResolvedValue({});
vi.mock('@/lib/api', () => ({
  api: { upload: (...a: unknown[]) => upload(...a), post: (...a: unknown[]) => post(...a) },
  ApiError: class ApiError extends Error {},
}));

import { SiteAccessRequests, waitingFor, kindLabel } from '@/components/site-access-requests';

const PATH = '/jobs/91/permission-requests';
const PRESIGNED = 'https://s3.ap-south-1.amazonaws.com/easyfix/perm/91-gate?X-Amz-Signature=abc';

/** A zone-less IST wall clock, exactly the shape the backend pool emits. */
function istStamp(msAgo: number): string {
  return new Date(Date.now() - msAgo)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' });
}

const OPEN_REQUEST = {
  id: 4, kind: 'mall_gate_pass', note: 'Security desk needs a pass before I can enter.',
  status: 'requested' as const, requestedAt: istStamp(30 * 60_000),
  fulfilledAt: null, documentUrl: null, requestedBy: 'Ramesh Kumar',
};

beforeEach(() => { setFetches({}); upload.mockClear(); post.mockClear(); });

describe('waitingFor', () => {
  const now = Date.parse('2026-09-07T12:00:00+05:30');
  // Zone-less strings — read as IST, which is the whole point.
  const at = (s: string) => waitingFor(s, now);

  it('reads a zone-less stamp as IST, not as browser-local', () => {
    expect(at('2026-09-07 11:30:00')).toBe('30 min');
    expect(at('2026-09-07 11:59:40')).toBe('just now');
    expect(at('2026-09-07 09:45:00')).toBe('2 hr 15 min');
    expect(at('2026-09-05 12:00:00')).toBe('2 days');
    expect(at('2026-09-06 12:00:00')).toBe('1 day');
  });

  it('says nothing rather than counting backwards on clock skew', () => {
    expect(at('2026-09-07 12:30:00')).toBeNull();
  });

  it('says nothing when there is no usable stamp', () => {
    expect(waitingFor(null, now)).toBeNull();
    expect(waitingFor('not a date', now)).toBeNull();
  });
});

describe('kindLabel', () => {
  it('unpacks a machine token without flattening an acronym', () => {
    // Casing is left to CSS `capitalize`, which raises first letters only —
    // a JS title-caser would turn "Society NOC" into "Society Noc".
    expect(kindLabel('mall_gate_pass')).toBe('mall gate pass');
    expect(kindLabel('Society NOC')).toBe('Society NOC');
    expect(kindLabel('')).toBe('Site Access');
  });
});

describe('SiteAccessRequests', () => {
  it('renders NOTHING on a job with no access requests', () => {
    setFetches({ [PATH]: { data: { items: [] } } });
    const { container } = render(<SiteAccessRequests jobId={91} />);
    expect(container.textContent).toBe('');
  });

  it('a failed load is stated, not silently shown as "no requests"', () => {
    setFetches({ [PATH]: { data: null, error: 'HTTP 500' } });
    const { container } = render(<SiteAccessRequests jobId={91} />);
    expect(container.textContent).toContain('could not be loaded');
  });

  it('an open request says a technician is waiting, and for how long', () => {
    setFetches({ [PATH]: { data: { items: [OPEN_REQUEST] } } });
    render(<SiteAccessRequests jobId={91} />);

    expect(screen.getByText('Technician Waiting On Site')).toBeTruthy();
    expect(screen.getByText('1 Waiting')).toBeTruthy();
    expect(screen.getByText('Waiting 30 min')).toBeTruthy();
    expect(screen.getByText(/Raised by Ramesh Kumar/)).toBeTruthy();
    expect(screen.getByText('Upload Document')).toBeTruthy();
  });

  it('waiting requests sort above settled ones', () => {
    setFetches({ [PATH]: { data: { items: [
      { ...OPEN_REQUEST, id: 1, status: 'fulfilled', kind: 'society noc', documentUrl: PRESIGNED },
      { ...OPEN_REQUEST, id: 2 },
    ] } } });
    const { container } = render(<SiteAccessRequests jobId={91} />);
    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent || '');
    expect(rows[0]).toContain('Technician Waiting On Site');
    expect(rows[1]).toContain('Fulfilled');
  });

  it('shows the uploaded document as the PRESIGNED url — never an <img>, never an authed endpoint', () => {
    setFetches({ [PATH]: { data: { items: [
      { ...OPEN_REQUEST, status: 'fulfilled', documentUrl: PRESIGNED, fulfilledAt: istStamp(0) },
    ] } } });
    const { container } = render(<SiteAccessRequests jobId={91} />);

    const link = screen.getByText('View Document').closest('a');
    expect(link?.getAttribute('href')).toBe(PRESIGNED);
    expect(link?.getAttribute('target')).toBe('_blank');
    // An <img> would 401 silently against an authed endpoint; there is no
    // content type on the row, so a PDF would render as a broken box anyway.
    expect(container.querySelector('img')).toBeNull();
  });

  /*
   * Both halves of the size gate, because a gate that refuses everything looks
   * identical to a working one from the failing side alone.
   */
  it('refuses an oversize file in the browser, and still uploads a normal one', () => {
    setFetches({ [PATH]: { data: { items: [OPEN_REQUEST] } } });
    const { container } = render(<SiteAccessRequests jobId={91} />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement;

    const pick = (bytes: number) => {
      const f = new File(['x'], 'gate-pass.pdf', { type: 'application/pdf' });
      Object.defineProperty(f, 'size', { value: bytes });
      fireEvent.change(input, { target: { files: [f] } });
    };

    pick(11 * 1024 * 1024);
    expect(screen.getByText(/larger than 10MB/)).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();

    pick(2 * 1024 * 1024);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe('/permission-requests/4/fulfil');
    // Multipart, field name "file" — the contract's field, not a JSON body.
    const fd = upload.mock.calls[0][1] as FormData;
    expect((fd.get('file') as File).name).toBe('gate-pass.pdf');
  });

  it('decline needs a reason and this app own confirm dialog — never window.confirm', () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    setFetches({ [PATH]: { data: { items: [OPEN_REQUEST] } } });
    render(<SiteAccessRequests jobId={91} />);

    fireEvent.click(screen.getByText('Decline'));
    const submit = screen.getByText('Decline Request').closest('button')!;
    expect(submit.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText(/Reason For Declining/), {
      target: { value: 'Mall does not issue passes on Sundays' },
    });
    expect(submit.hasAttribute('disabled')).toBe(false);

    fireEvent.click(submit);
    expect(screen.getByText('Decline Access Request')).toBeTruthy();
    expect(nativeConfirm).not.toHaveBeenCalled();
    // Nothing is posted until the dialog is confirmed.
    expect(post).not.toHaveBeenCalled();
  });

  it('confirming the dialog posts the reason to the contract path', async () => {
    setFetches({ [PATH]: { data: { items: [OPEN_REQUEST] } } });
    render(<SiteAccessRequests jobId={91} />);

    fireEvent.click(screen.getByText('Decline'));
    fireEvent.change(screen.getByLabelText(/Reason For Declining/), {
      target: { value: 'Gate pass office is closed' },
    });
    fireEvent.click(screen.getByText('Decline Request').closest('button')!);
    fireEvent.click(screen.getByText('Yes, Decline').closest('button')!);

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/permission-requests/4/decline', { reason: 'Gate pass office is closed' },
    ));
  });
});
