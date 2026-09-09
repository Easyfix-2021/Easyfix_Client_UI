'use client';

/*
 * Pending on you — every job in the client's book where a technician is
 * standing at a gate, in ONE place.
 *
 * The per-job panel (@/components/site-access-requests) already answers a
 * request, but only once someone has opened that job. Nobody opens a job to
 * discover there is something to open it for, so a request raised at 10am is
 * seen when the SPOC happens to look. This is the other half: the console says
 * which jobs are blocked, and the row answers them without leaving the page.
 *
 * ⚠ THIS PANEL NEEDS A BACKEND ENDPOINT THAT DOES NOT EXIST YET.
 *
 *   GET /api/client/permission-requests?status=requested&limit=100
 *      → { items: [ <the per-job item shape> + { reference, city, category } ],
 *          total }
 *
 * What exists today is per-JOB only: GET /api/client/jobs/:id/permission-requests.
 * There is deliberately no fan-out here — asking that endpoint once per open job
 * is N round trips to find the two rows that matter, and it gets slower exactly
 * as a client gets bigger. Until the list endpoint lands this renders NOTHING
 * (the 404 lands in `error`, and an unknown route is indistinguishable from
 * "no requests" to a portal that may be deployed ahead of its backend), so
 * shipping it early is inert rather than broken.
 *
 * The smallest backend addition, for whoever picks it up:
 *   services/job-permission-request.service.js already has toItem() and
 *   ROW_COLS. Add a listOpenForClient(clientId, scopeIds, limit) that runs the
 *   same SELECT with `JOIN tbl_job J ON J.job_id = jpr.job_id`, the existing
 *   `J.fk_client_id = ?` + hierarchyFilter scope from GET /api/client/action-queue,
 *   `jpr.status = 'requested'`, and the three job columns above; mount it in
 *   routes/client/index.js beside the two permission-request routes already
 *   there. No new table, no new access surface — answering a request is already
 *   ungated beyond loadJobInScope.
 *
 * WHY NOT FOLD IT INTO /action-queue. That endpoint's row is an ESTIMATE row —
 * estimateValue, approvable, a PATCH that clears it. A site-access row shares
 * none of that and carries three fields (request id, kind, note) it has no
 * column for, so the union would be a row type where over half the fields are
 * null on every row. Two endpoints, two shapes; the console shows them as two
 * panels because they are answered by two different people.
 */

import { ShieldAlert } from 'lucide-react';
import { useFetchOnce } from '@/lib/hooks';
import { openJobDrawer } from '@/components/job-drawer';
import { Panel, Pill, SectionLabel } from '@/components/ui/console';
import { RequestList, type PermissionRequest } from '@/components/site-access-requests';

/**
 * The per-job item plus the job identity the console has to print — on a job
 * page the address and reference are already on screen, here they are the only
 * way to tell two gate passes apart.
 */
export type PendingRequest = PermissionRequest & {
  jobId: number;
  reference?: string | null;
  city?: string | null;
  category?: string | null;
};

/* The endpoint's ceiling. A client with more than 100 technicians held at
   gates has a different problem than pagination. */
const LIMIT = 100;

export function PendingOnYou() {
  const { data, error, reload } = useFetchOnce<{ items: PendingRequest[] }>(
    `/permission-requests?status=requested&limit=${LIMIT}`,
  );

  /*
   * Belt and braces on `status`: the query says requested, but this panel's
   * whole claim is "someone is waiting", and a fulfilled row rendered under
   * that heading is a lie the reader cannot check.
   */
  const items = (data?.items ?? []).filter((r) => r.status === 'requested');

  /*
   * Nothing waiting → nothing on screen, and the same for a load that failed.
   * This is a console section, not the job page: a permanent "no site access
   * requests" panel is a row of furniture between the reader and the numbers
   * they came for, and an error banner would appear for every SPOC on every
   * open of a portal deployed before its backend.
   */
  if (error || !items.length) return null;

  return (
    <div className="mb-6">
      <SectionLabel>Pending on you</SectionLabel>
      <Panel
        accent="brand"
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-danger" aria-hidden />
            Site Access — A Technician Is Waiting
          </span>
        }
        action={<Pill accent="brand">{items.length} waiting</Pill>}
      >
        <RequestList
          items={items}
          reload={reload}
          context={(r) => {
            const p = r as PendingRequest;
            return (
              <button
                type="button"
                onClick={() => openJobDrawer(p.jobId)}
                className="text-xs font-semibold text-primary hover:text-primary-dark"
              >
                {p.reference || `Job ${p.jobId}`}
                {[p.city, p.category].filter(Boolean).length
                  ? ` · ${[p.city, p.category].filter(Boolean).join(' · ')}`
                  : ''}
              </button>
            );
          }}
        />
      </Panel>
    </div>
  );
}
