/*
 * Notifications page must render the REAL job-event shape GET /notices
 * returns (dashboard_notification_log: notice_id, title, message, is_read,
 * created_at, job_id) — not the tbl_notice Announcement shape (body,
 * category_id, action_url, images…) the page used to assume.
 *
 * The bug this guards against: the old page called
 * PATCH /notices/:id/read on a job-event row. That endpoint writes a
 * tbl_notice_read receipt (a table the job-event id has no relationship to)
 * and never touches dashboard_notification_log — so the tap "succeeded"
 * (200 OK, idempotent, no error surfaced) while the job notification stayed
 * unread forever. The correct call is PATCH /notices/read with
 * { notice_id } in the body — asserted explicitly below.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setFetches, lookup } from './helpers/page-harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/lib/hooks', () => ({
  useFetchOnce: (p: string | null) => lookup(p),
}));

const patch = vi.fn().mockResolvedValue({});
vi.mock('@/lib/api', () => ({
  api: { patch: (...a: unknown[]) => patch(...a) },
  ApiError: class ApiError extends Error {},
}));

const openJobDrawer = vi.fn();
vi.mock('@/components/job-drawer', () => ({
  openJobDrawer: (...a: unknown[]) => openJobDrawer(...a),
}));

import NotificationsPage from '@/app/(authed)/notifications/page';

const JOB_NOTICE = {
  notice_id: 501,
  title: 'Material request needs your approval',
  message: 'A technician has submitted materials for Job #482.',
  is_read: false,
  created_at: new Date().toISOString(),
  job_id: 482,
};

const READ_NOTICE = {
  notice_id: 502,
  title: 'Job completed',
  message: null,
  is_read: true,
  created_at: new Date().toISOString(),
  job_id: 900,
};

beforeEach(() => {
  patch.mockClear();
  openJobDrawer.mockClear();
  setFetches({
    '/notices': { data: { items: [JOB_NOTICE, READ_NOTICE] } },
    '/notice-board': { data: { items: [] } },
  });
});

describe('Notifications page — job-event shape', () => {
  it('renders title, message and job link from the job-event fields, not an Announcement shape', () => {
    render(<NotificationsPage />);
    expect(screen.getByText('Material request needs your approval')).toBeTruthy();
    expect(screen.getByText('A technician has submitted materials for Job #482.')).toBeTruthy();
    expect(screen.getByText('Job #482 — tap to open')).toBeTruthy();
    // A read row with no message must not crash rendering a null body.
    expect(screen.getByText('Job completed')).toBeTruthy();
  });

  it('clicking an unread job notice PATCHes /notices/read with its notice_id and opens its job drawer', async () => {
    render(<NotificationsPage />);
    fireEvent.click(screen.getByText('Material request needs your approval'));
    expect(patch).toHaveBeenCalledWith('/notices/read', { notice_id: 501 });
    // openJobDrawer fires after the PATCH promise settles (openNotice is
    // async and awaits it first) — flush that microtask before asserting.
    await waitFor(() => expect(openJobDrawer).toHaveBeenCalledWith(482));
  });

  it('does not re-PATCH an already-read notice, but still opens its job drawer', () => {
    render(<NotificationsPage />);
    fireEvent.click(screen.getByText('Job completed'));
    expect(patch).not.toHaveBeenCalled();
    expect(openJobDrawer).toHaveBeenCalledWith(900);
  });
});
