import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatIstDateTime, parseIstDateTime } from '@/lib/format';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const STATUS_LABELS: Record<number, string> = {
  0: 'Unconfirmed', 1: 'Scheduled', 2: 'In-Progress',
  3: 'Completed', 5: 'Completed', 6: 'Cancelled',
  7: 'Enquiry', 9: 'Call Later', 10: 'Revisit',
  15: 'Awaiting Approval', 21: 'On Hold',
};

/*
 * Bucket label for a given job_status code — the "Bucket" column on
 * the Order History table.
 *
 * Ported 1:1 from the Java backend CommonUtils.java#getBucketStatusForJob
 * (the legacy backend's canonical bucket→label mapping). Replaces the
 * earlier port of the Angular service-side helper which carried
 * outdated wording.
 *
 *   9                   → New Ticket
 *   15, 21              → Client Delay
 *   0, 1                → Committed Appointments
 *   2, 20               → Tx On Location
 *   3, 5                → Completed
 *   10                  → Under Audit
 *   6, 7                → Failed Order
 *   anything else       → '' (empty)
 */
export function getBucketStatusForJob(status: number | null | undefined): string {
  switch (status) {
    case 9:  return 'New Ticket';
    case 15:
    case 21: return 'Client Delay';
    case 0:
    case 1:  return 'Committed Appointments';
    case 2:
    case 20: return 'Tx On Location';
    case 3:
    case 5:  return 'Completed';
    case 10: return 'Under Audit';
    case 6:
    case 7:  return 'Failed Order';
    default: return '';
  }
}

/*
 * Context-aware bucket label — the "Status Of Order" column.
 *
 * Ported 1:1 from CommonUtils.java#getBucketCurrentStatusForJob. The
 * label depends on more than just job_status — for example a status=9
 * row can be Un-Authorize / Call Later / New Ticket depending on the
 * SPOC's approval flag and the call_later boolean.
 *
 * Required input fields on the row (all optional — the function falls
 * back gracefully when something's NULL):
 *   job_status
 *   approved_by_client        (job-level approve flag: 0/1/2/null)
 *   spoc_approval_by_client   (the reporting SPOC's approval setting)
 *   call_later                (bool)
 *   fk_easyfixter_id          (set ⇒ technician allocated)
 *   sub_job_id                (set ⇒ revisit was created)
 *   ready_for_billing         ('Yes'/'No')
 *   approval_sent_on_date_time
 *   approved_on_date_time
 *   approval_reject_date_time
 *   full_fillment_created_time
 *
 * Returns '' when no rule matches — caller can fall back to
 * getBucketStatusForJob() in that case.
 */
export type JobForBucket = {
  job_status: number | null;
  approved_by_client?: number | null;
  spoc_approval_by_client?: number | null;
  call_later?: number | boolean | null;
  fk_easyfixter_id?: number | null;
  sub_job_id?: number | null;
  ready_for_billing?: string | null;
  approval_sent_on_date_time?: string | null;
  approved_on_date_time?: string | null;
  approval_reject_date_time?: string | null;
  full_fillment_created_time?: string | null;
};

function ts(s: string | null | undefined): number | null {
  if (!s) return null;
  const d = new Date(s).getTime();
  return Number.isNaN(d) ? null : d;
}

export function getBucketCurrentStatusForJob(j: JobForBucket): string {
  const s = j.job_status;
  const callLater = j.call_later === 1 || j.call_later === true;

  // Status 9 — three sub-cases (Un-Authorize / Call Later / New Ticket)
  if (s === 9) {
    if (
      j.spoc_approval_by_client === 1 &&
      (j.approved_by_client === 0 || j.approved_by_client === 2)
    ) return 'Un-Authorize';
    if (callLater) return 'Call Later';
    return 'New Ticket';
  }

  // Status 0 — depends on technician allocation
  if (s === 0) {
    return j.fk_easyfixter_id ? 'Tx Allocated' : 'Tx Unallocated';
  }

  if (s === 1)  return 'Tx Ongoing Order';
  if (s === 2)  return 'Tx On Location';
  if (s === 20) return 'Tx On Location';

  // Status 3 / 5 — Completed; differentiate revisit-created vs ready-for-billing
  if (s === 3 || s === 5) {
    if (j.sub_job_id && j.sub_job_id > 0) return 'Visit Completed';
    if ((j.ready_for_billing || '').toLowerCase() === 'yes' && !j.sub_job_id) {
      return 'Ready for Billing';
    }
    return 'Completed';
  }

  if (s === 6) return 'Cancel Order';
  if (s === 7) return 'Enquiry Order';

  // Status 10 — five sub-cases depending on estimate flow + fulfilment hold
  if (s === 10) {
    const approvedOn = ts(j.approved_on_date_time);
    const rejectedOn = ts(j.approval_reject_date_time);
    const sentOn     = ts(j.approval_sent_on_date_time);
    const fohOn      = ts(j.full_fillment_created_time);
    const hasEstimate = sentOn != null;

    if (!hasEstimate && !fohOn) return 'Completed on TX App';

    if (hasEstimate && !fohOn) {
      if (approvedOn && !rejectedOn) return 'Estimate Approved';
      if (!approvedOn && rejectedOn) return 'Estimate Rejected';
      if (approvedOn && rejectedOn) {
        return rejectedOn > approvedOn ? 'Estimate Rejected' : 'Estimate Approved';
      }
    }

    if (!hasEstimate && fohOn) return 'Ready for Full-Fillement';

    if (hasEstimate && fohOn) {
      if (sentOn! > fohOn) {
        if (approvedOn && !rejectedOn) return 'Estimate Approved';
        if (!approvedOn && rejectedOn) return 'Estimate Rejected';
        if (approvedOn && rejectedOn) {
          return rejectedOn > approvedOn ? 'Estimate Rejected' : 'Estimate Approved';
        }
      }
      return 'Ready for Full-Fillement';
    }
    return '';
  }

  if (s === 15) return 'Approve Estimate';
  if (s === 21) return 'Full-Fillement on Hold';
  return '';
}

export function formatDate(d: string | Date | null | undefined) {
  if (!d) return '—';
  /*
   * Both halves moved to lib/format.ts, and both had to: the values are
   * zone-less IST wall clocks, so `new Date(d)` read them as browser-local AND
   * the getDate()/getHours() getters rendered them in the browser's zone. On an
   * IST machine those two errors cancelled exactly, which is why this looked
   * correct forever. Output format is unchanged: "DD-MM-YYYY HH:MM".
   */
  const date = parseIstDateTime(d);
  if (isNaN(date.getTime())) return '—';
  return formatIstDateTime(date);
}
