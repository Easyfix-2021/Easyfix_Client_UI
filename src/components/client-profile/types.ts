/*
 * Client Profile (portal) — shared types + the rail definition.
 *
 * One definition of the section list, imported by the page AND by the nav, so
 * a renamed section cannot drift out of step with the `?tab=` values that
 * existing links carry.
 */

export type ProfileTab =
  | 'overview'
  | 'roles'
  | 'contacts'
  | 'branches'
  | 'channels'
  | 'billing'
  | 'account'
  | 'services'
  | 'rate-cards'
  | 'sla'
  | 'notifications'
  | 'reports'
  | 'properties';

export const PROFILE_TABS: ReadonlyArray<{ key: ProfileTab; label: string }> = [
  { key: 'overview',      label: 'Overview' },
  { key: 'roles',         label: 'Roles & Actions' },
  { key: 'contacts',      label: 'Contacts' },
  { key: 'branches',      label: 'Branches' },
  { key: 'channels',      label: 'Booking Channels' },
  { key: 'billing',       label: 'Billing & Estimates' },
  { key: 'account',       label: 'Account & Payment' },
  { key: 'services',      label: 'Services' },
  { key: 'rate-cards',    label: 'Rate Cards' },
  { key: 'sla',           label: 'SLA & Priorities' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'reports',       label: 'Reports' },
  { key: 'properties',    label: 'Custom Properties' },
];

export function resolveProfileTab(raw: string | null | undefined): ProfileTab {
  const hit = PROFILE_TABS.find((t) => t.key === raw);
  return hit ? hit.key : 'overview';
}

/** GET /api/client/company */
export type Company = {
  clientId: number;
  clientName: string | null;
  displayName: string | null;
  billingName: string | null;
  techAppName: string | null;
  clientType: string | null;
  referenceCode: string | null;
  email: string | null;
  address: string | null;
  building: string | null;
  landmark: string | null;
  city: { id: number; name: string | null } | null;
  pincode: string | null;
  status: number;
  terms: {
    /* HOURS of lead time, not a clock time — see the endpoint's own note. */
    bookingCutOffHours: number | null;
    collectedBy: { code: number; label: string } | null;
    paidBy: { code: number; label: string } | null;
    travelDistanceKm: number | null;
    maxOrders: number | null;
    invoicing: { raised: boolean; cycle: string | null; startDate: string | null };
  };
  kyc: { cin: string | null; pan: string | null; mouContact: string | null };
  createdAt: string | null;
  updatedAt: string | null;
  /* Resolved SERVER-SIDE from the same gate the PUT applies. Never re-derive
     it on the client from the role — the two would drift. */
  canEdit: boolean;
  editable: string[];
};

/** GET /api/client/company/documents */
export type CompanyDocument = {
  document_id: number;
  doc_type: string;
  doc_label: string | null;
  original_filename: string | null;
  content_type: string | null;
  uploaded_at: string;
  url: string | null;
};

export type DocumentsResponse = {
  items: CompanyDocument[];
  provisioned: boolean;
  canEdit: boolean;
};

/** The EasyFix people who look after this client — GET /api/client/support-contacts */
export type SupportContacts = {
  primary: Array<{ email: string; name: string | null; mobile: string | null }>;
  secondary: Array<{ email: string; name: string | null; mobile: string | null }>;
};

/** One row of GET /api/client/team */
export type TeamMember = {
  id: number;
  name: string | null;
  email: string | null;
  mobile: string | null;
  designation: string | null;
  managerId: number | null;
  status: number;
  approvalByClient: number | null;
};

/** GET /api/client/stores */
export type Store = {
  id: number;
  store_code: string | null;
  store_name: string | null;
  contact_name: string | null;
  contact_no: string | null;
  address: string | null;
  city_name: string | null;
  pin_code: string | null;
};

/** GET /api/client/invoices */
export type InvoicesResponse = {
  summary: { billed: number; collected: number; outstanding: number; count: number };
  aging: { a0_30: number; a31_60: number; a60plus: number; unpaid: number };
  items: Array<{
    id: number;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    dueDate: string | null;
    total: number;
    paid: number;
    due: number;
    status: 'paid' | 'partial' | 'unpaid';
    pdfPath: string | null;
  }>;
};

/** The slice of GET /api/client/performance this page reads. */
export type PerformanceSlice = {
  window: { from: string; to: string; label: string };
  targets: {
    sla_pct: number;
    ftfr_pct: number;
    revisit_pct: number;
    avg_age_days: number;
    approval_response_hours: number;
    source: 'contracted' | 'platform-default';
  };
  tat: {
    jobsAnalysed: number;
    efScorePct: number | null;
    labels: { Excellent: number; Good: number; Partial: number; Poor: number; Pending: number };
  };
};

/** Indian-locale integer, the same shape the Rate Card page uses. */
export const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/*
 * yyyy-mm-dd from LOCAL date parts. Deliberately not toISOString(): the SPOC
 * is in IST, and between 00:00 and 05:30 IST toISOString() reports YESTERDAY —
 * which would silently shift a 30-day window for anyone opening the page
 * before breakfast. Same trap the backend's ist-calendar helpers exist for.
 */
export function localIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
