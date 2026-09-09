/*
 * Pending on you — the cross-job site-access panel.
 *
 * Five things that would fail silently:
 *
 *   1. IT SHIPS AHEAD OF ITS BACKEND. The list endpoint does not exist yet, so
 *      every SPOC's first load of this panel is a 404. If that surfaced as an
 *      error banner, the whole estate would see a red box on Home until the two
 *      deploys met. It must render NOTHING.
 *
 *   2. THE FILE INPUT MUST NOT BE IMAGE-ONLY. The real permits are a portal
 *      screenshot, a photo of a stamped paper form, and Pazo PDF exports. An
 *      accept list without application/pdf silently hides two thirds of them
 *      from the picker, and the client concludes the feature is broken.
 *
 *   3. THE 10MB GATE IS CLIENT-SIDE TOO. A phone photo of an A4 form clears
 *      10MB easily. Without the local check the client waits out the whole
 *      upload on mall 4G to be told no.
 *
 *   4. ONLY OPEN REQUESTS. The panel's entire claim is "someone is waiting".
 *      A fulfilled row under that heading is a lie the reader cannot check.
 *
 *   5. THE JOB IDENTITY. On the job page the reference is already on screen;
 *      here it is the only way to tell two gate passes apart.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

import { PendingOnYou } from '@/components/pending-on-you';

const PATH = '/permission-requests';

/** A zone-less IST wall clock, exactly the shape the backend pool emits. */
const istStamp = (msAgo: number) =>
  new Date(Date.now() - msAgo).toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' });

const WAITING = {
  id: 7,
  jobId: 4412,
  reference: 'LKST2028',
  city: 'Mumbai',
  category: 'Carpentry',
  kind: 'mall_gate_pass',
  note: 'Phoenix Palladium needs a work permit before 10pm.',
  status: 'requested' as const,
  requestedAt: istStamp(45 * 60_000),
  fulfilledAt: null,
  documentUrl: null,
  requestedBy: 'Ramesh Kumar',
};

beforeEach(() => { setFetches({}); upload.mockClear(); post.mockClear(); });

describe('PendingOnYou', () => {
  it('renders NOTHING while the list endpoint is missing — a 404 is not a banner', () => {
    setFetches({ [PATH]: { data: null, error: 'HTTP 404' } });
    const { container } = render(<PendingOnYou />);
    expect(container.textContent).toBe('');
  });

  it('renders NOTHING when nobody is waiting', () => {
    setFetches({ [PATH]: { data: { items: [] } } });
    const { container } = render(<PendingOnYou />);
    expect(container.textContent).toBe('');
  });

  it('names the job, the permit and the wait, and offers both answers', () => {
    setFetches({ [PATH]: { data: { items: [WAITING] } } });
    render(<PendingOnYou />);

    // The job identity — this panel is the only place the row is out of context.
    expect(screen.getByText(/LKST2028 · Mumbai · Carpentry/)).toBeTruthy();
    expect(screen.getByText('mall gate pass')).toBeTruthy();
    expect(screen.getByText(/Phoenix Palladium needs a work permit/)).toBeTruthy();
    expect(screen.getByText('Waiting 45 min')).toBeTruthy();
    expect(screen.getByText('1 waiting')).toBeTruthy();
    // A client who cannot get a permit must be able to say so, not just stall.
    expect(screen.getByText('Upload Document')).toBeTruthy();
    expect(screen.getByText('Decline')).toBeTruthy();
  });

  it('drops a request that is no longer open', () => {
    setFetches({ [PATH]: { data: { items: [
      { ...WAITING, id: 8, status: 'fulfilled' as const },
    ] } } });
    const { container } = render(<PendingOnYou />);
    expect(container.textContent).toBe('');
  });

  it('accepts PDFs as well as images — the real permits are both', () => {
    setFetches({ [PATH]: { data: { items: [WAITING] } } });
    const { container } = render(<PendingOnYou />);
    const accept = container.querySelector('input[type=file]')!.getAttribute('accept') || '';
    expect(accept).toContain('application/pdf');
    expect(accept).toContain('image/jpeg');
  });

  it('refuses an oversize scan locally, and still uploads a normal one to the contract path', () => {
    setFetches({ [PATH]: { data: { items: [WAITING] } } });
    const { container } = render(<PendingOnYou />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement;

    const pick = (bytes: number, name: string, type: string) => {
      const f = new File(['x'], name, { type });
      Object.defineProperty(f, 'size', { value: bytes });
      fireEvent.change(input, { target: { files: [f] } });
    };

    pick(11 * 1024 * 1024, 'scan.pdf', 'application/pdf');
    expect(screen.getByText(/larger than 10MB/)).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();

    pick(3 * 1024 * 1024, 'permit.pdf', 'application/pdf');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe('/permission-requests/7/fulfil');
    // Multipart, field name "file" — the contract's field, not a JSON body.
    const fd = upload.mock.calls[0][1] as FormData;
    expect((fd.get('file') as File).name).toBe('permit.pdf');
  });

  it('decline is gated on a reason and on this app own confirm dialog', () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    setFetches({ [PATH]: { data: { items: [WAITING] } } });
    render(<PendingOnYou />);

    fireEvent.click(screen.getByText('Decline'));
    const submit = screen.getByText('Decline Request').closest('button')!;
    // The route's Joi bound is trim().min(3); two characters must not pass.
    fireEvent.change(screen.getByLabelText(/Reason For Declining/), { target: { value: 'no' } });
    expect(submit.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText(/Reason For Declining/), {
      target: { value: 'Mall does not issue permits before 10pm' },
    });
    expect(submit.hasAttribute('disabled')).toBe(false);

    fireEvent.click(submit);
    expect(screen.getByText('Decline Access Request')).toBeTruthy();
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
