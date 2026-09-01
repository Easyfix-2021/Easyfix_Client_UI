/*
 * tbl_job_image classification — the ONE place in this app that decides what a
 * job image IS.
 *
 * Mirrors `EasyFix_Backend/utils/job-image-buckets.js`, which is the source of
 * truth; keep the two in step. Several producers write that table with
 * different vocabularies for the same evidence, and every consumer that
 * re-derived the rules got a different subset of them right:
 *
 *   legacy Java / Flutter stack   'checkin' / 'checkout'      job_stage 2
 *     (537k checkout, 445k checkin — still nearly every row)
 *   EasyFix_Backend, new app      'checkin' / 'checkout' too (2026-09-01;
 *                                  it used to store 'Booking' / 'Completion')
 *   website / WhatsApp / CRM      'booking'                   job_stage 0
 *   partner API v1 + v2           'unconfirmed'               job_stage 0
 *   customer feedback PDF         'feedback'                  job_stage 5
 *
 * ⚠ `job_stage` is not a before/after axis and is only a last resort here.
 * Measured over the whole table: stage 2 carries BOTH checkin and checkout so
 * it cannot separate them; stage 0 also carries po/jobsheet/questionaire; stage
 * 5 is 278k feedback PDFs. The technician app's read model used
 * `OR job_stage = 5` for its "after" half and returned 278,977 rows of which
 * ZERO were work photos.
 *
 * Matched against CLOSED SETS rather than a loose /before|start/ regex: a
 * substring test would put `job_sheet` or `signature` in a photo tile the
 * moment someone adds a category containing one of those fragments.
 */

export type ImageBucket = 'before' | 'after' | 'jobsheet' | 'material' | 'other';

/** A tbl_job_image row, as every client endpoint projects it. */
export interface JobImageRow {
  image_id: number;
  /** Nullable in the wild — an image row can exist with no stored file. */
  image: string | null;
  image_category: string | null;
  job_stage?: number | string | null;
}

export const norm = (s: string | null | undefined) =>
  String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

export const BEFORE_CATS = new Set([
  'booking', 'start_job', 'startjob', 'checkin', 'check_in',
  'site_inspection', 'siteinspection', 'before', 'unconfirmed',
]);
export const AFTER_CATS = new Set(['completion', 'checkout', 'check_out', 'after']);
export const JOBSHEET_CATS = new Set(['job_sheet', 'jobsheet']);
export const MATERIAL_CATS = new Set(['material_used', 'material', 'materials', 'bom']);
export const FEEDBACK_CATS = new Set(['feedback']);
export const PO_CATS = new Set(['po', 'purchase_order']);

export function bucketOf(im: Pick<JobImageRow, 'image_category' | 'job_stage'>): ImageBucket {
  const c = norm(im.image_category);
  if (BEFORE_CATS.has(c)) return 'before';
  if (AFTER_CATS.has(c)) return 'after';
  if (JOBSHEET_CATS.has(c)) return 'jobsheet';
  if (MATERIAL_CATS.has(c)) return 'material';
  // Number(null) is 0, and 0 is a REAL stage (start_job) — so an untagged row
  // would land in "Before" if the null were not excluded first.
  const raw = im.job_stage;
  if (raw === null || raw === undefined || raw === '') return 'other';
  const st = Number(raw);
  if (st === 0 || st === 1) return 'before';
  if (st === 5) return 'after';
  if (st === 2) return 'jobsheet';
  if (st === 3) return 'material';
  return 'other';
}

/** The customer's signed feedback form. Always a PDF; never a photo tile. */
export const isFeedback = (im: Pick<JobImageRow, 'image_category'>) =>
  FEEDBACK_CATS.has(norm(im.image_category));

/** A purchase-order attachment. 92% PDF. */
export const isPo = (im: Pick<JobImageRow, 'image_category'>) =>
  PO_CATS.has(norm(im.image_category));

/** A PDF attachment is a document, not a photo — keep it out of the tiles. */
export const isPhoto = (im: Pick<JobImageRow, 'image'>) =>
  !/\.pdf$/i.test(String(im.image ?? ''));
