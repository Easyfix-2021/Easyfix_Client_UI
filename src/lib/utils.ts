import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
 * Bucket label for a given job_status code.
 *
 * Ported 1:1 from the legacy Angular_ClientDashboard
 * shared.service.ts#getStatusInText (line 176). These are the SAME
 * labels operators saw in the legacy "Status of Order" and "Bucket"
 * table columns, so SPOCs already familiar with the dashboard see
 * identical wording.
 *
 * Codes:
 *   0, 1       → Appointment Confirm
 *   2, 20      → Start with Otp
 *   15         → Approve Estimate
 *   21         → Fulfilment on Hold
 *   9          → My New Tickets
 *   10         → Handyman Completed on-app
 *   3, 5       → Visit Done
 *   6          → Cancel Job
 *   7          → Enquiry
 *   22         → Approved Billing
 *   anything else → "Not Defined"
 */
export function getBucketLabel(status: number | null | undefined): string {
  switch (status) {
    case 0:
    case 1:  return 'Appointment Confirm';
    case 2:
    case 20: return 'Start with Otp';
    case 15: return 'Approve Estimate';
    case 21: return 'Fulfilment on Hold';
    case 9:  return 'My New Tickets';
    case 10: return 'Handyman Completed on-app';
    case 3:
    case 5:  return 'Visit Done';
    case 6:  return 'Cancel Job';
    case 7:  return 'Enquiry';
    case 22: return 'Approved Billing';
    default: return 'Not Defined';
  }
}

export function formatDate(d: string | Date | null | undefined) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
