'use client';

/*
 * "Book a technician" — redesigned 2026-05-30.
 *
 * Layout shift from v1:
 *   - Hero card with brand-red stripe + friendly greeting
 *   - Three NUMBERED section cards (Customer / Location / Attachments)
 *     each with a step circle + icon so the form scans like a wizard
 *     without forcing pagination
 *   - Sticky live SUMMARY rail  on desktop (right side) — updates as
 *     fields fill, showing "what's about to be booked" + a required-
 *     field tick list. Mobile collapses it.
 *   - Sticky bottom action bar (Reset · Cancel · Book Now) with a
 *     dynamic "X of Y required fields filled" pill so the user always
 *     knows what's left.
 *
 * Backend wiring unchanged (POST /api/client/jobs).
 *
 * Bootstraps:
 *   GET  /lookup/service-categories  → tenant-contracted categories
 *   GET  /me/custom-properties       → per-tenant dynamic extra fields
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  Plus, X, AlertCircle, ChevronDown, Search, Check, Loader2,
  User, MapPin, Camera, Hash, ChevronRight,
  Phone, Briefcase, FileText, CreditCard, Sparkles, AlertTriangle,
  Tag, ClipboardList, ImageIcon as ImageLucide,
  Calendar, Clock, CheckCircle2,
  Home, Building, MapPinned, Crosshair,
  Film, Play, File as FileGeneric,
  Store, Smartphone,
  Snowflake, Refrigerator, WashingMachine, Zap, Droplets, Microwave, Tv, Flame, AirVent, Wrench,
  ArrowLeft,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSpoc } from '@/lib/spoc-context';

type ServiceCategory = { id: number; name: string };
type CustomProperty = { name: string; label: string | null; mandatory: boolean };

type FormState = {
  customer_mob_no: string;
  customer_name: string;
  customer_id: number | null;          // populated by mobile auto-lookup
  customer_email: string;
  alternate_name: string;
  alternate_mob_no: string;
  service_category_ids: number[];
  job_desc: string;
  job_types: { Installation: boolean; Repair: boolean; 'Un-Installation': boolean };
  payment: 'paid' | 'free' | '';
  // Service-location block — flat for backend compat. The "Add
  // Address Details" popup edits these and the form summary card
  // renders them. All except gps_location + address_type land on
  // tbl_address (backend insertAddress takes them verbatim);
  // address_type is FE-only metadata prepended to `address` so the
  // type tag is preserved without changing the backend schema.
  address: string;
  city_id: number | null;              // required by backend insertAddress
  pin_code: string;
  building: string;                    // Society / Flat / Floor / Block Name
  landmark: string;                    // Nearby Landmark
  gps_location: string;                // "lat,lng"  (browser geolocation or manual)
  address_type: 'Home' | 'Office' | 'Other' | '';
  client_ref_id: string;
  notes: string;
  custom_props: Record<string, string>;
  // Inline appointment — replaces the old popup. SPOC picks date +
  // slot as part of the form, Book Now submits everything.
  appt_date: string;                   // YYYY-MM-DD
  appt_slot: TimeSlot | '';
};

// A store/branch row from the client's store directory (GET /stores/lookup).
type Store = {
  id: number;
  store_code: string;
  store_name: string | null;
  contact_name: string | null;
  contact_no: string | null;
  address: string | null;
  city_id: number | null;
  city_name: string | null;
  pin_code: string | null;
};

// Time slot options shown in the appointment picker — labels match the
// legacy Angular dashboard's TimeSlot constant exactly so payloads sent
// to /jobs are 1:1 with the legacy contract (e.g. "After 7pm").
const TIME_SLOTS = [
  '9am to 12pm',
  '12pm to 3pm',
  '3pm to 7pm',
  'After 7pm',
] as const;
type TimeSlot = typeof TIME_SLOTS[number];

// Today as a YYYY-MM-DD string in local time — fed into the <input
// type="date"> min attribute so past dates can't be selected.
function todayLocalISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const EMPTY: FormState = {
  customer_mob_no: '',
  customer_name: '',
  customer_id: null,
  customer_email: '',
  alternate_name: '',
  alternate_mob_no: '',
  service_category_ids: [],
  job_desc: '',
  job_types: { Installation: false, Repair: false, 'Un-Installation': false },
  payment: '',
  address: '',
  city_id: null,
  pin_code: '',
  building: '',
  landmark: '',
  gps_location: '',
  address_type: '',
  client_ref_id: '',
  notes: '',
  custom_props: {},
  appt_date: '',
  appt_slot: '',
};

// The address sub-form is edited in a DRAFT before it's committed to the
// main `form` (only on Add-Details "Continue"/Save). Seeding the draft —
// rather than `form` — when a place / saved address / current location is
// picked means cancelling the popup leaves the summary card untouched
// (no half-finished address leaking through). Shape mirrors AddressDialog's
// `initial` prop exactly.
type AddressDraft = Pick<
  FormState,
  'address' | 'city_id' | 'pin_code' | 'building' | 'landmark' | 'gps_location' | 'address_type'
>;
const EMPTY_ADDR: AddressDraft = {
  address: '',
  city_id: null,
  pin_code: '',
  building: '',
  landmark: '',
  gps_location: '',
  address_type: '',
};

/*
 * Greeting name — return the SPOC's full display name verbatim
 * ("Mr. Rahul Jadhav") for the "Hello …" header on the New Order page.
 * Legacy ACD splits on whitespace and grabs [0], which produced just
 * "Mr." when the stored name carries a salutation. We render the full
 * trimmed string instead so the greeting reads "Hello Mr. Rahul Jadhav".
 */
function firstNameOf(full?: string): string {
  if (!full) return '';
  return full.trim();
}

function humanize(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/*
 * Indian mobile pattern check — used by the auto-customer-lookup
 * effect (lookup only fires on a structurally valid number to avoid
 * thrashing the BE on every keystroke). NOT enough on its own at
 * submit time — see isValidMobile below for the junk-pattern check.
 */
function isTenDigits(v: string) {
  return /^[6-9]\d{9}$/.test(v.trim());
}

/*
 * Submit-time validation: structurally valid AND not an obvious junk
 * pattern. Operators routinely type "9999999999" / "8888888888" /
 * "9876543210" as placeholders when the customer's real number isn't
 * handy — those then propagate as ghost customers in tbl_customer and
 * break the auto-fill / address-book / notification flows downstream.
 *
 * Rejects:
 *   - All same digit       (e.g. 9999999999, 8888888888, 1111111111)
 *   - Sequential ascending (e.g. 1234567890, 6234567890)
 *   - Sequential descending(e.g. 9876543210, 0987654321)
 *   - Pair-repeat          (e.g. 9090909090, 8989898989) — these are
 *                          almost always fake-data shortcuts
 * Returns:
 *   { ok: true } | { ok: false, reason: '…' }
 */
function isValidMobile(v: string): { ok: true } | { ok: false; reason: string } {
  const m = v.trim();
  if (!isTenDigits(m)) return { ok: false, reason: 'Enter a valid 10-digit mobile' };
  if (/^(\d)\1{9}$/.test(m)) {
    return { ok: false, reason: 'Mobile cannot be the same digit repeated 10 times' };
  }
  // Sequential — check that consecutive digits differ by +1 or by -1
  // every step. Holds true for both 1234567890-style ascending and
  // 9876543210-style descending sequences.
  const allAsc = m.split('').every((d, i, a) =>
    i === 0 || (Number(d) - Number(a[i - 1]) + 10) % 10 === 1);
  const allDesc = m.split('').every((d, i, a) =>
    i === 0 || (Number(a[i - 1]) - Number(d) + 10) % 10 === 1);
  if (allAsc || allDesc) {
    return { ok: false, reason: 'Sequential digits aren’t a real mobile number' };
  }
  // Pair-repeat — ABABABABAB pattern.
  if (m.length === 10 && /^(\d)(\d)\1\2\1\2\1\2\1\2$/.test(m)) {
    return { ok: false, reason: 'That looks like a placeholder, not a real number' };
  }
  return { ok: true };
}

/**
 * Best-effort icon for a service category. Categories are tenant-configured
 * (real names from /lookup/service-categories), so we match on keywords and
 * fall back to a generic wrench for anything unrecognised.
 */
function iconForCategory(name: string): LucideIcon {
  const n = (name || '').toLowerCase();
  if (/\bac\b|air.?con|cooling|hvac/.test(n)) return Snowflake;
  if (/fridge|refriger/.test(n)) return Refrigerator;
  if (/wash|laundr/.test(n)) return WashingMachine;
  if (/electric|wiring|switch|socket|mcb/.test(n)) return Zap;
  if (/plumb|tap|water|pipe|leak|geyser|bath|sink/.test(n)) return Droplets;
  if (/microwave|oven|otg/.test(n)) return Microwave;
  if (/\btv\b|televis|led|display|monitor/.test(n)) return Tv;
  if (/heat|boiler|flame|gas|stove|chimney|burner/.test(n)) return Flame;
  if (/fan|cooler|vent|exhaust|purifier/.test(n)) return AirVent;
  return Wrench;
}

export default function NewOrderPage() {
  const router = useRouter();
  const spoc = useSpoc();
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [customProps, setCustomProps] = useState<CustomProperty[]>([]);
  const [cities, setCities] = useState<{ id: number; name: string }[]>([]);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [files, setFiles] = useState<File[]>([]);
  const [showAltModal, setShowAltModal] = useState(false);
  // Two-step address flow:
  //   1. selectAddressOpen → "Select Address" picker (saved list +
  //      Use Current Location + Search). Opens when SPOC clicks the
  //      address summary card.
  //   2. addressDialogOpen → "Add Address Details" full form (map +
  //      GPS + Pincode + City + Building + Landmark + Address Type).
  //      Opens when SPOC picks Use Current Location, edits a saved
  //      address, or chooses to add a brand-new one.
  const [selectAddressOpen, setSelectAddressOpen] = useState(false);
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  // Draft the Add-Details popup edits; only committed to `form` on Save.
  const [addrDraft, setAddrDraft] = useState<AddressDraft>(EMPTY_ADDR);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const bootedRef = useRef(false);

  // Customer auto-fill state. We re-fetch after each completed
  // 10-digit mobile entry and bump the contact-name field if the
  // SPOC hasn't already typed one themselves (don't clobber user
  // input). `lastLookupMobile` dedupes so we don't refetch on every
  // keystroke once the mobile is complete.
  const [customerLookup, setCustomerLookup] = useState<{
    state: 'idle' | 'loading' | 'found' | 'new' | 'error';
    name?: string | null;
    email?: string | null;
  }>({ state: 'idle' });
  const lastLookupMobile = useRef<string>('');

  // Success modal — shown after backend confirms with a job_id.
  const [successJobId, setSuccessJobId] = useState<number | null>(null);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    (async () => {
      const results = await Promise.allSettled([
        api.get<{ items: ServiceCategory[] }>('/lookup/service-categories'),
        api.get<{ items: CustomProperty[] }>('/me/custom-properties'),
        // ?scope=all — full active-city catalog (~472), not just the
        // ones our client has previously booked in. Bookings can land
        // in any active city.
        api.get<{ items: { id: number; name: string }[] }>('/lookup/cities?scope=all'),
      ]);
      if (results[0].status === 'rejected' && results[1].status === 'rejected') {
        setBootError('Unable to load order form data. Please refresh.');
      }
      setCategories(results[0].status === 'fulfilled' ? results[0].value.items ?? [] : []);
      setCustomProps(results[1].status === 'fulfilled' ? results[1].value.items ?? [] : []);
      setCities(results[2].status === 'fulfilled' ? results[2].value.items ?? [] : []);
      setBootstrapped(true);
    })();
  }, []);

  // Auto-fill customer name when a valid 10-digit mobile is entered.
  // Debounced via dependency on form.customer_mob_no — fires once per
  // distinct complete number. Doesn't clobber a user-typed name; only
  // populates when the name field is empty.
  useEffect(() => {
    const mob = form.customer_mob_no.trim();
    if (!isTenDigits(mob)) {
      // Reset to idle when number is incomplete/invalid so stale
      // "found" hints don't linger from a previous value.
      if (customerLookup.state !== 'idle') setCustomerLookup({ state: 'idle' });
      return;
    }
    if (mob === lastLookupMobile.current) return;  // already fetched
    lastLookupMobile.current = mob;

    let cancelled = false;
    setCustomerLookup({ state: 'loading' });
    (async () => {
      try {
        const res = await api.get<{ customer: null | {
          customer_id: number; customer_name: string;
          customer_mob_no: string; customer_email: string | null;
        }}>(`/customers/mobile/${mob}`);
        if (cancelled) return;
        if (res?.customer) {
          setCustomerLookup({
            state: 'found',
            name: res.customer.customer_name,
            email: res.customer.customer_email,
          });
          // Populate id + email always (backend uses these for the
          // upsert path); only populate name if SPOC hasn't typed.
          setForm((f) => ({
            ...f,
            customer_id: res.customer!.customer_id,
            customer_email: res.customer!.customer_email || '',
            customer_name: f.customer_name.trim() || res.customer!.customer_name || '',
          }));
        } else {
          // New customer — clear stale id from a previous mobile.
          setCustomerLookup({ state: 'new' });
          setForm((f) => ({ ...f, customer_id: null, customer_email: '' }));
        }
      } catch {
        if (cancelled) return;
        setCustomerLookup({ state: 'error' });
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.customer_mob_no]);

  const altSummary = useMemo(() => {
    if (!form.alternate_mob_no && !form.alternate_name) return null;
    return `${form.alternate_name || '—'} · ${form.alternate_mob_no || '—'}`;
  }, [form.alternate_mob_no, form.alternate_name]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => { const { [key]: _, ...rest } = e; return rest; });
  }

  // ─── Booking case ──────────────────────────────────────────────────
  // The SPOC picks HOW they're booking before filling the form:
  //   'mobile' → an individual customer, found by mobile number
  //   'store'  → a registered store / branch, found by store code
  // The form adapts to the choice (see the mode chooser + store card).
  const [bookingMode, setBookingMode] = useState<'mobile' | 'store'>('mobile');

  // ─── Wizard step (1 Customer & Service · 2 Location & Schedule · 3 Review) ──
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ─── Book by store code ────────────────────────────────────────────
  // Type a store code → prefill the store's name / contact / address from
  // the client's store directory, so the SPOC only enters the service,
  // description and appointment.
  const [storeCode, setStoreCode] = useState('');
  const [storeLookup, setStoreLookup] = useState<'idle' | 'loading' | 'found' | 'notfound'>('idle');
  const [storeName, setStoreName] = useState('');
  async function lookupStore() {
    const code = storeCode.trim();
    if (!code) return;
    setStoreLookup('loading');
    try {
      const res = await api.get<{ store: Store | null }>(`/stores/lookup?code=${encodeURIComponent(code)}`);
      if (res?.store) {
        const s = res.store;
        setForm((f) => ({
          ...f,
          customer_name:   s.store_name || s.contact_name || f.customer_name,
          customer_mob_no: s.contact_no || f.customer_mob_no,
          address:         s.address || f.address,
          pin_code:        s.pin_code || f.pin_code,
          city_id:         s.city_id ?? f.city_id,
          client_ref_id:   s.store_code || f.client_ref_id,
        }));
        setStoreName(s.store_name || s.store_code);
        setStoreLookup('found');
      } else {
        setStoreLookup('notfound');
      }
    } catch {
      setStoreLookup('notfound');
    }
  }

  function toggleJobType(t: keyof FormState['job_types']) {
    setForm((f) => ({ ...f, job_types: { ...f.job_types, [t]: !f.job_types[t] } }));
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setFiles((cur) => [...cur, ...picked]);
    e.target.value = '';
  }

  function removeFile(i: number) {
    setFiles((cur) => cur.filter((_, idx) => idx !== i));
  }

  // Live required-field checklist for the summary rail + bottom bar.
  // The required set depends on the booking case:
  //   • Store / branch      → the store code is the key required field;
  //     mobile + name are filled FROM the store, so they aren't required.
  //   • Individual customer → mobile + name are required (no store code).
  const requiredChecks = useMemo(() => {
    const checks: { key: string; label: string; ok: boolean }[] = [];
    if (bookingMode === 'store') {
      checks.push({ key: 'storeCode', label: 'Store code', ok: storeCode.trim().length > 0 && storeLookup === 'found' });
    } else {
      checks.push({ key: 'customer_mob_no', label: 'Customer mobile', ok: isValidMobile(form.customer_mob_no).ok });
      checks.push({ key: 'customer_name',   label: 'Contact name',    ok: form.customer_name.trim().length > 0 });
    }
    checks.push({ key: 'service_category_ids', label: 'Service category', ok: form.service_category_ids.length > 0 });
    checks.push({ key: 'job_desc',        label: 'Problem description', ok: form.job_desc.trim().length > 0 });
    checks.push({ key: 'address',         label: 'Address',          ok: form.address.trim().length > 0 });
    checks.push({ key: 'client_ref_id',   label: 'Order reference ID', ok: form.client_ref_id.trim().length > 0 });
    customProps.filter((cp) => cp.mandatory).forEach((cp) => {
      checks.push({
        key: `cp_${cp.name}`,
        label: cp.label || humanize(cp.name),
        ok: (form.custom_props[cp.name] ?? '').trim().length > 0,
      });
    });
    return checks;
  }, [form, customProps, bookingMode, storeCode, storeLookup]);

  const filledCount = requiredChecks.filter((c) => c.ok).length;
  const allRequiredOk = filledCount === requiredChecks.length;

  // Pure error computation (no setState) so step navigation can scope which
  // errors block the "Continue" without mutating the whole error map.
  function computeErrors(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (bookingMode === 'store') {
      // Store / branch case — the store code is the required field. Mobile
      // and name are filled from the store, so they aren't required here;
      // we only sanity-check the mobile's FORMAT if one is present.
      if (storeLookup !== 'found') {
        errs.storeCode = storeCode.trim() ? 'Enter a valid store code' : 'Store code is required';
      }
      if (form.customer_mob_no.trim()) {
        const v = isValidMobile(form.customer_mob_no);
        if (!v.ok) errs.customer_mob_no = v.reason;
      }
    } else {
      // Individual customer case — mobile + name are required.
      if (!form.customer_mob_no.trim()) {
        errs.customer_mob_no = 'Mobile number is required';
      } else {
        const v = isValidMobile(form.customer_mob_no);
        if (!v.ok) errs.customer_mob_no = v.reason;
      }
      if (!form.customer_name.trim()) errs.customer_name = 'Contact name is required';
    }
    if (form.service_category_ids.length === 0) errs.service_category_ids = 'Pick at least one service category';
    if (!form.job_desc.trim()) errs.job_desc = 'Describe the problem';
    if (!form.address.trim()) errs.address = 'Address is required';
    if (!form.city_id)        errs.city_id = 'Pick a city';
    if (!form.client_ref_id.trim()) errs.client_ref_id = "Brand's order reference ID is required";
    if (form.alternate_mob_no) {
      const v = isValidMobile(form.alternate_mob_no);
      if (!v.ok) errs.alternate_mob_no = v.reason.replace('Mobile', 'Alternate mobile');
    }
    if (form.alternate_mob_no && form.alternate_mob_no === form.customer_mob_no) {
      errs.alternate_mob_no = 'Alternate mobile must be different from the primary mobile';
    }
    if (!form.appt_date)      errs.appt_date = 'Pick an appointment date';
    else if (form.appt_date < todayLocalISO()) errs.appt_date = 'Appointment date cannot be in the past';
    if (!form.appt_slot)      errs.appt_slot = 'Pick a time slot';
    customProps.forEach((cp) => {
      if (cp.mandatory && !(form.custom_props[cp.name] ?? '').trim()) {
        errs[`cp_${cp.name}`] = `${cp.label || humanize(cp.name)} is required`;
      }
    });
    return errs;
  }

  // Returns the errors map so callers can use it immediately
  // (setFieldErrors is async — reading state right after won't reflect it).
  function validate(): Record<string, string> {
    const errs = computeErrors();
    setFieldErrors(errs);
    return errs;
  }

  // ─── Wizard navigation ─────────────────────────────────────────────
  // Which error keys belong to each step, so "Continue" only blocks on the
  // fields visible in the current step.
  const STEP1_KEYS = ['storeCode', 'customer_mob_no', 'customer_name', 'service_category_ids', 'job_desc'];
  const STEP2_KEYS = ['address', 'city_id', 'client_ref_id', 'appt_date', 'appt_slot'];
  function isStepKey(s: 1 | 2 | 3, k: string): boolean {
    if (s === 1) return STEP1_KEYS.includes(k) || k.startsWith('cp_');
    if (s === 2) return STEP2_KEYS.includes(k) || k === 'alternate_mob_no';
    return true;
  }
  function goNext() {
    const all = computeErrors();
    const mine = Object.fromEntries(Object.entries(all).filter(([k]) => isStepKey(step, k)));
    setFieldErrors(mine);
    if (Object.keys(mine).length > 0) {
      const first = Object.keys(mine)[0];
      document.querySelector(`[data-field="${first}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const n = Object.keys(mine).length;
      setError(`${n} field${n === 1 ? '' : 's'} on this step need${n === 1 ? 's' : ''} attention.`);
      return;
    }
    setError(null);
    setFieldErrors({});
    setStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : s));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function goBack() {
    setError(null);
    setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Validate everything (including inline appointment) and POST in a
  // single step — no popup. Backend expects a nested payload shape
  // (customer + address objects), so we restructure here.
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      const firstKey = Object.keys(errs)[0];
      const el = document.querySelector(`[data-field="${firstKey}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const count = Object.keys(errs).length;
      setError(`${count} field${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention — see the highlighted fields above.`);
      return;
    }

    setSubmitting(true);
    try {
      const job_types = (Object.keys(form.job_types) as Array<keyof FormState['job_types']>)
        .filter((k) => form.job_types[k]);

      // Backend `jobService.create` expects nested customer + address
      // objects (see services/job.service.js#upsertCustomer +
      // #insertAddress). The flat shape used in earlier iterations
      // caused 500s — the upsert tried to read undefined fields.
      const payload = {
        customer: {
          customer_id:      form.customer_id || undefined,
          customer_name:    form.customer_name.trim(),
          customer_mob_no:  form.customer_mob_no.trim(),
          customer_email:   form.customer_email || undefined,
        },
        address: {
          // Prepend "[Home]" / "[Office]" / "[Other]" tag so the
          // address-type choice is preserved without needing a new
          // backend column (tbl_address has no address_type field).
          address: (form.address_type
            ? `[${form.address_type}] ${form.address.trim()}`
            : form.address.trim()),
          city_id:    form.city_id,
          pin_code:   form.pin_code || '',
          building:   form.building.trim() || undefined,
          landmark:   form.landmark.trim() || undefined,
          locality:   undefined,
          gps_location: form.gps_location.trim() || undefined,
          mobile_number: form.customer_mob_no.trim(),
        },
        fk_service_catg_id: form.service_category_ids[0] || null,
        job_desc:    form.job_desc.trim(),
        job_type:    job_types.length ? job_types.join(',') : 'Repair',
        source_type: 'New Dashboard',
        client_ref_id: form.client_ref_id.trim(),
        collected_by: form.payment === 'free' ? 2 : 1,
        additional_name:   form.alternate_name.trim() || '',
        additional_number: form.alternate_mob_no.trim() || '',
        // "Notes for technician" — saved on tbl_job.efr_special_notes
        // (the dedicated technician-facing notes column). `remarks` is
        // reserved for the internal narrative comment thread; keeping
        // them separate matches the legacy CRM and lets the technician
        // app surface this exact field on the Job Sheet screen.
        efr_special_notes: form.notes.trim() || null,
        custom_property: customProps
          .map((cp) => `${cp.label || cp.name}:${form.custom_props[cp.name] ?? ''}`)
          .filter((s) => !s.endsWith(':'))
          .join('|'),
        // Appointment fields — legacy parity (also drives the inline
        // appointment card)
        requested_date_time: `${form.appt_date}T00:00:00`,
        requested_time: '',
        time_slot: form.appt_slot,
        initial_status: 9,  // CALL_LATER — same as legacy "jobStatus":9
      };

      const res = await api.post<{ job_id: number }>('/jobs', payload);
      if (files.length && res?.job_id) {
        console.info(`[new-order] job ${res.job_id} created; ${files.length} file(s) await upload.`);
      }
      setSuccessJobId(res?.job_id ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create order');
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setForm(EMPTY);
    setFiles([]);
    setFieldErrors({});
    setError(null);
  }

  // Names selected categories will display in the summary rail
  const selectedCategoryNames = useMemo(
    () => categories.filter((c) => form.service_category_ids.includes(c.id)).map((c) => c.name),
    [categories, form.service_category_ids]
  );

  if (!bootstrapped) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="mt-3 text-sm">Loading your order form…</p>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-rose-600">
        <AlertCircle className="w-8 h-8" />
        <p className="mt-3 text-sm">{bootError}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-6xl mx-auto pb-32 px-1 sm:px-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs sm:text-sm text-slate-500 mb-3">
        <Link href="/dashboard" className="hover:text-primary">Dashboard</Link>
        <ChevronRight className="w-3 h-3 text-slate-300" />
        <span className="font-semibold text-slate-800">New Order</span>
      </div>

      {/* Hero card with brand-red side stripe — stacks on mobile, side-
          by-side from sm:. Smaller padding and heading on phones so the
          required-fields pill doesn't crowd the greeting. */}
      <div className="relative bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-4 sm:mb-5">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary via-primary-dark to-primary" />
        <div className="p-4 sm:p-5 md:p-6 flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 inline-flex items-center gap-2 leading-tight">
              <Sparkles className="w-5 h-5 text-primary shrink-0" />
              <span className="truncate">Book a technician</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Tell us about the work and we&apos;ll dispatch a technician right away.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs sm:text-sm font-semibold self-start sm:self-auto shrink-0">
            <ClipboardList className="w-4 h-4" />
            {filledCount} / {requiredChecks.length} required filled
          </div>
        </div>
      </div>

      {/* Booking method + store code — only relevant on Step 1. */}
      {step === 1 && (<>
      {/* How are you booking? — slim segmented toggle. The form adapts:
          Individual customer → mobile + name; Store / branch → store code. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
          How are you booking?
        </p>
        <div className="inline-flex flex-wrap gap-1 p-1 rounded-xl border border-slate-200 bg-slate-100">
          {([
            { key: 'mobile', title: 'Individual customer', sub: 'by mobile number', Icon: Smartphone },
            { key: 'store',  title: 'Store / branch',      sub: 'by store code',    Icon: Store },
          ] as const).map((m) => {
            const active = bookingMode === m.key;
            const Icon = m.Icon;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setBookingMode(m.key)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-bold transition',
                  active ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                <Icon className="w-4 h-4" />
                {m.title}
                <span className="hidden sm:inline text-xs font-medium opacity-60">· {m.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Book by store code — shown only in the Store/branch case. Prefills
          the customer & address from the client's store directory, so only
          service + appointment remain. */}
      {bookingMode === 'store' && (
      <div data-field="storeCode" className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3.5 mb-3">
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-primary" /> Book by store code <span className="text-rose-500">*</span>
        </label>
        <div className="mt-2 relative sm:max-w-xs">
          <input
            value={storeCode}
            onChange={(e) => { setStoreCode(e.target.value); setStoreLookup('idle'); setFieldErrors((er) => { const { storeCode: _drop, ...rest } = er; return rest; }); }}
            onBlur={() => void lookupStore()}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
            placeholder="e.g. STR-142"
            className={cn('w-full rounded-lg border border-slate-300 px-3 py-2 pr-24 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30', fieldErrors.storeCode && 'border-rose-300 ring-1 ring-rose-300')}
          />
          {storeLookup === 'loading' && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Looking up…</span>
          )}
        </div>
        {storeLookup === 'notfound' && (
          <p className="mt-2 text-xs font-semibold text-rose-600">No store found for that code.</p>
        )}
        {fieldErrors.storeCode && storeLookup !== 'notfound' && (
          <p className="mt-2 text-xs text-rose-600 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {fieldErrors.storeCode}
          </p>
        )}

        {storeLookup === 'found' ? (
          // Matched store — show its details right here, so the SPOC doesn't
          // re-enter the customer/address (those fields are hidden below).
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-white grid place-items-center text-blue-600 shrink-0">
                <Store className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">{storeName}</div>
                <div className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-1">
                  <Check className="w-3 h-3" /> Matched — details filled from your directory
                </div>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {form.customer_name && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 bg-white border border-emerald-200 rounded-full px-2.5 py-1">
                  <User className="w-3 h-3 text-emerald-600" /> {form.customer_name}
                </span>
              )}
              {form.customer_mob_no && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 bg-white border border-emerald-200 rounded-full px-2.5 py-1">
                  <Phone className="w-3 h-3 text-emerald-600" /> {form.customer_mob_no}
                </span>
              )}
              {form.address && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 bg-white border border-emerald-200 rounded-full px-2.5 py-1 max-w-full">
                  <MapPin className="w-3 h-3 text-emerald-600 shrink-0" /> <span className="truncate">{form.address}</span>
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-1.5 text-[11px] text-slate-400">
            Fills contact &amp; address — you only add the service, description &amp; appointment.
          </p>
        )}
      </div>
      )}
      </>)}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 flex items-start gap-2 mb-5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Wizard progress — 1 Customer & Service · 2 Location & Schedule · 3 Review */}
      <div className="mb-5 overflow-x-auto">
        <div className="flex items-center min-w-max">
          {([
            { n: 1, label: 'Customer & Service' },
            { n: 2, label: 'Location & Schedule' },
            { n: 3, label: 'Review & Confirm' },
          ] as const).map((st, i) => {
            const done = step > st.n;
            const on = step === st.n;
            return (
              <div key={st.n} className="flex items-center">
                <div className="flex items-center gap-2.5">
                  <span className={cn(
                    'w-8 h-8 rounded-full grid place-items-center text-sm font-bold shrink-0 transition',
                    on ? 'bg-primary text-white shadow-md shadow-primary/30'
                      : done ? 'bg-primary/15 text-primary'
                      : 'bg-slate-100 text-slate-400'
                  )}>
                    {done ? <Check className="w-4 h-4" /> : st.n}
                  </span>
                  <span className={cn('text-sm font-bold whitespace-nowrap', on ? 'text-slate-900' : 'text-slate-400')}>
                    {st.label}
                  </span>
                </div>
                {i < 2 && <span className={cn('mx-3 sm:mx-4 h-0.5 w-8 sm:w-16 rounded-full', step > st.n ? 'bg-primary' : 'bg-slate-200')} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Two-column on desktop: form (left) + sticky summary (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">

        {/* ─── LEFT: form sections ───────────────────────────── */}
        <div className="space-y-5 min-w-0">

          {/* ══ STEP 1 — Customer & Service ══ */}
          {step === 1 && (
          <StepCard step={1} icon={User} title="Customer &amp; Service"
            subtitle="Who needs the technician and what kind of work?">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Individual-customer case only — in Store mode the customer's
                  contact comes from the store (shown in the store card above). */}
              {bookingMode === 'mobile' && (<>
              <Field
                label="Customer mobile" required={bookingMode === 'mobile'}
                error={fieldErrors.customer_mob_no}
                icon={Phone}
                dataField="customer_mob_no"
              >
                <div className="relative">
                  <input
                    className={cn('input pr-9', fieldErrors.customer_mob_no && 'ring-1 ring-rose-300')}
                    inputMode="numeric"
                    maxLength={10}
                    value={form.customer_mob_no}
                    onChange={(e) => setField('customer_mob_no', e.target.value.replace(/\D/g, ''))}
                    placeholder="10-digit mobile"
                  />
                  {/* Lookup status indicator — shows after a complete
                      mobile is typed so the SPOC sees that the system
                      checked for an existing customer. */}
                  {customerLookup.state === 'loading' && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
                  )}
                  {customerLookup.state === 'found' && (
                    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-600" />
                  )}
                  {customerLookup.state === 'new' && (
                    <Sparkles className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                  )}
                </div>
                {/* Friendly under-field hint that mirrors the lookup state */}
                {customerLookup.state === 'found' && (
                  <p className="mt-1.5 text-xs text-emerald-700 inline-flex items-center gap-1">
                    <Check className="w-3 h-3" /> Existing customer — name auto-filled
                  </p>
                )}
                {customerLookup.state === 'new' && (
                  <p className="mt-1.5 text-xs text-primary inline-flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> New customer — please add a name below
                  </p>
                )}
              </Field>

              <Field
                label="Contact name" required={bookingMode === 'mobile'}
                error={fieldErrors.customer_name}
                icon={User}
                dataField="customer_name"
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowAltModal(true)}
                    className="text-primary hover:underline text-xs font-semibold inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {altSummary ? 'Edit alternate' : 'Add alternate'}
                  </button>
                }
              >
                <input
                  className={cn('input', fieldErrors.customer_name && 'ring-1 ring-rose-300')}
                  value={form.customer_name}
                  onChange={(e) => setField('customer_name', e.target.value)}
                  placeholder="Person who'll coordinate with the technician"
                />
                {altSummary && (
                  <p className="mt-1.5 text-xs text-slate-500 inline-flex items-center gap-1">
                    <Tag className="w-3 h-3" /> Alt: {altSummary}
                  </p>
                )}
              </Field>
              </>)}

              <Field
                label="Service category" required
                error={fieldErrors.service_category_ids}
                icon={Briefcase}
                className="md:col-span-2"
                dataField="service_category_ids"
              >
                {categories.length === 0 ? (
                  <div className="text-sm text-slate-400 italic border border-dashed border-slate-200 rounded-xl px-4 py-6 text-center">
                    No categories configured for your account.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                    {categories.map((cat) => {
                      const on = form.service_category_ids.includes(cat.id);
                      const Icon = iconForCategory(cat.name);
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() =>
                            setField(
                              'service_category_ids',
                              on
                                ? form.service_category_ids.filter((id) => id !== cat.id)
                                : [...form.service_category_ids, cat.id],
                            )
                          }
                          className={cn(
                            'relative flex flex-col items-center justify-center gap-2 rounded-xl border p-3 min-h-[92px] text-center transition',
                            on
                              ? 'border-primary bg-primary-50/60 shadow-sm'
                              : fieldErrors.service_category_ids
                                ? 'border-rose-200 hover:border-slate-300 bg-white'
                                : 'border-slate-200 hover:border-slate-300 bg-white',
                          )}
                        >
                          {on && (
                            <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary text-white grid place-items-center">
                              <Check className="w-2.5 h-2.5" strokeWidth={3} />
                            </span>
                          )}
                          <Icon className={cn('w-7 h-7', on ? 'text-primary' : 'text-slate-500')} strokeWidth={1.6} />
                          <span className={cn('text-xs font-semibold leading-tight', on ? 'text-primary' : 'text-slate-600')}>
                            {cat.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>

              <Field
                label="Describe the problem" required
                error={fieldErrors.job_desc}
                icon={FileText}
                className="md:col-span-2"
                dataField="job_desc"
              >
                <textarea
                  rows={3}
                  className={cn('input resize-y', fieldErrors.job_desc && 'ring-1 ring-rose-300')}
                  value={form.job_desc}
                  onChange={(e) => setField('job_desc', e.target.value)}
                  placeholder="e.g. AC stops cooling after 20 minutes, water leaking near the indoor unit."
                />
              </Field>

              {/* Job Type — chip-style checkboxes for better tap target */}
              <Field label="Job type" icon={Briefcase}>
                <div className="flex flex-wrap gap-2">
                  {(['Installation', 'Repair', 'Un-Installation'] as const).map((t) => {
                    const on = form.job_types[t];
                    return (
                      <button
                        key={t} type="button"
                        onClick={() => toggleJobType(t)}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition',
                          on
                            ? 'bg-primary text-white border-primary shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                        )}
                      >
                        {on && <Check className="w-3.5 h-3.5" />}
                        {t}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* Payment — segmented control */}
              <Field label="Payment mode" icon={CreditCard}>
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                  {([
                    ['paid', 'Paid by Customer'],
                    ['free', 'Free for Customer'],
                  ] as const).map(([k, label]) => (
                    <button
                      key={k} type="button"
                      onClick={() => setField('payment', k)}
                      className={cn(
                        'px-3 py-1.5 rounded-md text-sm font-medium transition',
                        form.payment === k
                          ? 'bg-white text-primary shadow-sm border border-slate-200'
                          : 'text-slate-600 hover:text-slate-900'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Custom properties — if any */}
              {customProps.length > 0 && (
                <div className="md:col-span-2 pt-3 mt-1 border-t border-slate-100">
                  <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 inline-flex items-center gap-1">
                    <Tag className="w-3 h-3" /> Custom properties
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {customProps.map((cp) => (
                      <Field
                        key={cp.name}
                        label={cp.label || humanize(cp.name)}
                        required={cp.mandatory}
                        error={fieldErrors[`cp_${cp.name}`]}
                        icon={Hash}
                        dataField={`cp_${cp.name}`}
                      >
                        <input
                          className={cn('input', fieldErrors[`cp_${cp.name}`] && 'ring-1 ring-rose-300')}
                          value={form.custom_props[cp.name] ?? ''}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              custom_props: { ...f.custom_props, [cp.name]: e.target.value }
                            }))
                          }
                          placeholder={cp.label || humanize(cp.name)}
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </StepCard>
          )}

          {/* ══ STEP 2 — Location & Schedule (address + appointment + files) ══ */}
          {step === 2 && (<>
          {/* Service Location */}
          <StepCard step={2} icon={MapPin} title="Service Location"
            subtitle="Where should the technician go?">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Address picker — compact card mirroring the legacy
                  "Address for Technician" preview (your image 1). Click
                  anywhere → opens the SelectAddressDialog which lists
                  the customer's saved addresses + "Use current
                  location" + search. From there the Add-Details popup
                  fires for editing / new entries. */}
              <div className="md:col-span-2" data-field="address">
                <button
                  type="button"
                  onClick={() => setSelectAddressOpen(true)}
                  className={cn(
                    'w-full text-left rounded-lg border bg-white px-4 py-3 transition',
                    fieldErrors.address || fieldErrors.city_id
                      ? 'border-rose-300 ring-1 ring-rose-200'
                      : 'border-slate-200 hover:border-primary hover:bg-primary/5'
                  )}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1.5">
                    Address for Technician
                  </div>
                  {form.address || form.building ? (
                    <>
                      <div className="text-sm text-slate-900 leading-snug">
                        {[form.building, form.address].filter(Boolean).join(', ')}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {[cities.find((c) => c.id === form.city_id)?.name, form.pin_code, form.landmark]
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-slate-400 italic inline-flex items-center gap-2">
                      <MapPinned className="w-4 h-4" />
                      Click to select or add an address
                    </div>
                  )}
                </button>
                {(fieldErrors.address || fieldErrors.city_id) && (
                  <p className="text-xs text-rose-600 mt-1.5 inline-flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {fieldErrors.address || fieldErrors.city_id}
                  </p>
                )}
              </div>

              <Field
                label="Brand's order reference ID" required
                error={fieldErrors.client_ref_id}
                icon={Hash}
                dataField="client_ref_id"
                className="md:col-span-2"
              >
                <input
                  className={cn('input', fieldErrors.client_ref_id && 'ring-1 ring-rose-300')}
                  value={form.client_ref_id}
                  onChange={(e) => setField('client_ref_id', e.target.value)}
                  placeholder="Your internal order / ticket reference"
                />
              </Field>

              <Field label="Notes for technician (optional)" icon={FileText}
                className="md:col-span-2">
                <textarea
                  rows={3}
                  className="input resize-y"
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  placeholder="Parking, gate code, customer preferences, etc."
                />
              </Field>
            </div>
          </StepCard>

          {/* STEP 3 — Appointment (inline) */}
          <StepCard step={3} icon={Calendar} title="Appointment"
            subtitle="When should the technician come? Past dates are blocked.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Appointment date" required
                error={fieldErrors.appt_date}
                icon={Calendar}
                dataField="appt_date"
              >
                <input
                  type="date"
                  className={cn('input', fieldErrors.appt_date && 'ring-1 ring-rose-300')}
                  value={form.appt_date}
                  min={todayLocalISO()}
                  onChange={(e) => setField('appt_date', e.target.value)}
                />
              </Field>

              <Field
                label="Time slot" required
                error={fieldErrors.appt_slot}
                icon={Clock}
                dataField="appt_slot"
              >
                <div className="grid grid-cols-2 gap-2">
                  {TIME_SLOTS.map((s) => {
                    const on = form.appt_slot === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setField('appt_slot', s)}
                        className={cn(
                          'px-3 py-2 rounded-lg text-sm font-semibold border transition text-left inline-flex items-center gap-1.5',
                          on
                            ? 'bg-primary text-white border-primary shadow-sm shadow-primary/20'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                        )}
                      >
                        <Clock className={cn('w-3.5 h-3.5 shrink-0', on ? 'text-white' : 'text-slate-400')} />
                        <span className="truncate">{s}</span>
                        {on && <Check className="w-4 h-4 ml-auto" />}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
          </StepCard>

          {/* STEP 4 — Attachments (photos + videos) */}
          <StepCard step={4} icon={Camera} title="Attachments"
            subtitle="Optional — photos or short videos that help the technician prepare.">
            <div className={cn(
              'rounded-xl border-2 border-dashed p-5 transition',
              files.length > 0 ? 'border-primary/30 bg-primary-50/30' : 'border-slate-200 bg-slate-50/40'
            )}>
              {files.length === 0 ? (
                <div className="text-center py-4">
                  <div className="inline-flex items-center gap-2 mb-2">
                    <ImageLucide className="w-9 h-9 text-slate-300" />
                    <Film       className="w-9 h-9 text-slate-300" />
                  </div>
                  <p className="text-sm text-slate-500 mb-1">No files attached yet.</p>
                  <p className="text-[11px] text-slate-400 mb-3">
                    Photos (jpg/png/heic) or videos (mp4/mov) — up to 25 MB each.
                  </p>
                  <label className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-primary-dark transition shadow-sm">
                    <Plus className="w-4 h-4" /> Add Photos / Videos
                    <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={onPickFiles} />
                  </label>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-3">
                    {files.map((f, i) => (
                      <FileTile
                        key={`${f.name}-${f.size}-${i}`}
                        file={f}
                        onRemove={() => removeFile(i)}
                      />
                    ))}
                  </div>
                  <label className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-primary text-sm font-semibold cursor-pointer hover:bg-primary-50 transition">
                    <Plus className="w-4 h-4" /> Add more
                    <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={onPickFiles} />
                  </label>
                </>
              )}
              <p className="text-xs text-slate-400 mt-3 text-center">
                Files attach after the order is created.
              </p>
            </div>
          </StepCard>
          </>)}

          {/* ══ STEP 3 — Review & Confirm ══ */}
          {step === 3 && (
          <StepCard step={3} icon={CheckCircle2} title="Review &amp; Confirm"
            subtitle="Check everything below, then place the order.">
            <div className="divide-y divide-slate-100">
              {[
                { icon: bookingMode === 'store' ? Store : User, label: bookingMode === 'store' ? 'Store' : 'Customer',
                  value: bookingMode === 'store'
                    ? (storeName || storeCode || '—')
                    : [form.customer_name, form.customer_mob_no].filter(Boolean).join(' · ') || '—', jump: 1 as const },
                { icon: Briefcase, label: 'Service', value: selectedCategoryNames.join(', ') || '—', jump: 1 as const },
                { icon: FileText, label: 'Problem', value: form.job_desc || '—', jump: 1 as const },
                { icon: MapPin, label: 'Address', value: [form.building, form.address, cities.find((c) => c.id === form.city_id)?.name].filter(Boolean).join(', ') || '—', jump: 2 as const },
                { icon: Hash, label: 'Reference', value: form.client_ref_id || '—', jump: 2 as const },
                { icon: Calendar, label: 'Appointment', value: [form.appt_date, form.appt_slot].filter(Boolean).join(' · ') || '—', jump: 2 as const },
                { icon: Camera, label: 'Attachments', value: files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'None', jump: 2 as const },
              ].map((row) => {
                const RIcon = row.icon;
                return (
                  <div key={row.label} className="flex items-start gap-3 py-3">
                    <span className="w-9 h-9 rounded-lg bg-primary-50 text-primary grid place-items-center shrink-0">
                      <RIcon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{row.label}</div>
                      <div className="text-sm text-slate-800 break-words">{row.value}</div>
                    </div>
                    <button type="button" onClick={() => setStep(row.jump)}
                      className="text-xs font-bold text-primary hover:underline shrink-0 mt-0.5">
                      Edit
                    </button>
                  </div>
                );
              })}
            </div>
          </StepCard>
          )}
        </div>

        {/* ─── RIGHT: sticky summary rail ───────────────────── */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-3">
            {/* Summary card */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 inline-flex items-center gap-1">
                <ClipboardList className="w-3 h-3" /> Booking summary
              </div>
              <dl className="space-y-3 text-sm">
                <SummaryRow icon={User}     label="Contact"    value={form.customer_name || '—'}
                  sub={form.customer_mob_no || undefined} />
                <SummaryRow icon={Briefcase} label="Services"   value={selectedCategoryNames.length ? `${selectedCategoryNames.length} selected` : '—'}
                  sub={selectedCategoryNames.slice(0, 2).join(', ') || undefined} />
                <SummaryRow icon={MapPin}    label="Address"    value={form.address || '—'} />
                <SummaryRow icon={Hash}      label="Reference"  value={form.client_ref_id || '—'} />
                <SummaryRow icon={Camera}    label="Attachments" value={files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : '—'} />
              </dl>
            </div>

            {/* Required-field tick list */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 inline-flex items-center gap-1">
                <Check className="w-3 h-3" /> Required ({filledCount}/{requiredChecks.length})
              </div>
              <ul className="space-y-1.5 text-xs">
                {requiredChecks.map((c) => (
                  <li key={c.key} className="flex items-center gap-2">
                    <span className={cn(
                      'w-4 h-4 rounded-full grid place-items-center shrink-0',
                      c.ok ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-300'
                    )}>
                      {c.ok && <Check className="w-3 h-3" />}
                    </span>
                    <span className={cn(
                      'truncate',
                      c.ok ? 'text-slate-500 line-through' : 'text-slate-700 font-medium'
                    )}>
                      {c.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>
      </div>

      {/* Sticky bottom action bar — safe-area aware on iPhone, two-row
          layout on tight mobile widths so the "Book Now" CTA stays
          finger-sized and never gets squeezed under Cancel. */}
      <div className="fixed bottom-0 left-0 lg:left-64 right-0 z-30 bg-white border-t border-slate-200 shadow-xl pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 flex items-center justify-between sm:justify-end gap-2">
          {/* Mobile-only required-fields summary so the SPOC sees
              progress without scrolling up to the hero pill. */}
          <div className="sm:hidden text-[11px] font-semibold text-slate-600 inline-flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5 text-primary" />
            {filledCount}/{requiredChecks.length}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {step === 1 ? (
              <>
                <button
                  type="button"
                  onClick={reset}
                  className="hidden sm:inline-flex text-sm text-slate-600 hover:text-primary underline-offset-2 hover:underline px-2"
                >
                  Reset
                </button>
                <Link href="/dashboard" className="btn-outline text-sm px-3 py-2 sm:px-4 sm:py-2">Cancel</Link>
              </>
            ) : (
              <button
                type="button"
                onClick={goBack}
                className="btn-outline text-sm px-3 py-2 sm:px-4 sm:py-2 inline-flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}

            {step < 3 ? (
              <button
                type="button"
                onClick={goNext}
                className="btn-primary text-sm px-4 py-2 sm:px-5 sm:py-2 inline-flex items-center gap-1.5"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary text-sm px-4 py-2 sm:px-5 sm:py-2 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {submitting
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Booking…</>
                  : <>Book Now <ChevronRight className="w-4 h-4" /></>}
              </button>
            )}
          </div>
        </div>
      </div>

      {showAltModal && (
        <AlternateModal
          name={form.alternate_name}
          number={form.alternate_mob_no}
          error={fieldErrors.alternate_mob_no}
          onClose={() => setShowAltModal(false)}
          onSave={(name, number) => {
            setField('alternate_name', name);
            setField('alternate_mob_no', number);
            setShowAltModal(false);
          }}
        />
      )}

      {selectAddressOpen && (
        <SelectAddressDialog
          customerMobile={form.customer_mob_no}
          cities={cities}
          onClose={() => setSelectAddressOpen(false)}
          onPickPlace={(prefill) => {
            // Google Place suggestion picked — seed the Add Details
            // DRAFT (not `form`) with everything Google gave us (address,
            // gps, pin, city). All four come from one geocode so they
            // stay consistent. Building / landmark / type start blank.
            setAddrDraft({
              ...EMPTY_ADDR,
              address:      prefill.address      ?? '',
              city_id:      prefill.city_id      ?? null,
              pin_code:     prefill.pin_code     ?? '',
              gps_location: prefill.gps_location ?? '',
            });
            setSelectAddressOpen(false);
            setAddressDialogOpen(true);
          }}
          onPickSaved={(a) => {
            // Saved address chosen → load values into the Add Details
            // DRAFT so the SPOC can confirm/tweak. address_type is reset
            // so they explicitly pick one for this booking.
            setAddrDraft({
              ...EMPTY_ADDR,
              address:      a.address || '',
              city_id:      a.city_id ?? null,
              pin_code:     a.pin_code || '',
              building:     a.building || '',
              landmark:     a.landmark || '',
              gps_location: a.gps_location || '',
            });
            setSelectAddressOpen(false);
            setAddressDialogOpen(true);
          }}
          onAddNew={() => {
            // Hop to the full Add Details popup with a blank draft.
            setAddrDraft(EMPTY_ADDR);
            setSelectAddressOpen(false);
            setAddressDialogOpen(true);
          }}
          onUseCurrentLocation={(gps) => {
            // Use Current Location → seed ONLY the new GPS and clear the
            // descriptive fields, so the Add-Details reverse-geocode
            // re-derives address / pincode / city from this coordinate.
            // (Previously the stale address/pin/city were left behind,
            // so the GPS no longer matched what was shown.)
            setAddrDraft({ ...EMPTY_ADDR, gps_location: gps });
            setSelectAddressOpen(false);
            setAddressDialogOpen(true);
          }}
        />
      )}

      {addressDialogOpen && (
        <AddressDialog
          initial={addrDraft}
          cities={cities}
          // Cancel: just close. `form` was never touched (edits live in
          // the draft), so the summary card keeps whatever was last saved
          // — no half-finished address leaks through.
          onClose={() => setAddressDialogOpen(false)}
          onSave={(v) => {
            setForm((f) => ({ ...f, ...v }));
            // Clear address-related field errors now that fresh values
            // are coming in — they'll re-validate on Book Now.
            setFieldErrors((fe) => {
              const next = { ...fe };
              delete next.address;
              delete next.city_id;
              return next;
            });
            setAddressDialogOpen(false);
          }}
        />
      )}

      {successJobId != null && (
        <SuccessModal
          jobId={successJobId}
          onClose={() => {
            setSuccessJobId(null);
            router.push('/dashboard');
          }}
        />
      )}
    </form>
  );
}

// ───────────────────────────────────────────────────────────────────
// Subcomponents
// ───────────────────────────────────────────────────────────────────

/*
 * PlacesAutocomplete — inline Google Places autocomplete input.
 *
 * Drop-in for the "Complete Address" field in the Add Address Details
 * popup. As the SPOC types, fires GET /api/client/maps/autocomplete
 * (debounced 300ms, 3-char minimum, AbortController to drop stale
 * responses), then renders a dropdown of `{primary, secondary}` rows
 * directly under the input. Picking a row hands the place_id back to
 * the parent via onPickPlace, which does the geocode → fill flow.
 *
 * Matches the legacy CRM "Confirm & Schedule" page UX so SPOCs migrating
 * from the old dashboard recognise the pattern immediately.
 */
function PlacesAutocomplete({
  value, onTextChange, onPickPlace, geocoding,
}: {
  value: string;
  onTextChange: (text: string) => void;
  onPickPlace: (placeId: string, description: string) => void | Promise<void>;
  geocoding?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [acLoading, setAcLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Suppress the next fetch — set when we just picked a suggestion so
  // the resulting onTextChange (which fills the field with the picked
  // description) doesn't immediately re-open the dropdown.
  const skipNextFetchRef = useRef(false);

  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3) { setItems([]); setOpen(false); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setAcLoading(true);
      try {
        const res = await api.get<{ items: PlaceSuggestion[] }>(
          `/maps/autocomplete?q=${encodeURIComponent(q)}`,
          { signal: ctl.signal }
        );
        setItems(res.items || []);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setItems([]); setOpen(false);
        }
      } finally {
        setAcLoading(false);
      }
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [value]);

  // Close on outside click. Single listener attached only when the
  // dropdown is open so we don't run JS on every page-wide click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  async function pick(s: PlaceSuggestion) {
    setResolving(true);
    skipNextFetchRef.current = true;
    setOpen(false);
    try {
      await onPickPlace(s.place_id, s.description);
    } finally {
      setResolving(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        className="input w-full pr-10"
        value={value}
        onChange={(e) => onTextChange(e.target.value)}
        onFocus={() => { if (items.length > 0) setOpen(true); }}
        placeholder='e.g. Ambience Mall, Gurugram'
        autoFocus
      />
      {(acLoading || resolving || geocoding) && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 text-[10px] font-semibold text-primary">
          <Loader2 className="w-3 h-3 animate-spin" />
          {resolving ? 'Loading…' : geocoding ? 'Filling…' : 'Searching…'}
        </span>
      )}

      {open && items.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {items.map((s) => (
            <button
              key={s.place_id}
              type="button"
              onClick={() => pick(s)}
              disabled={resolving}
              className="w-full text-left flex items-start gap-3 px-3 py-2.5 border-b border-slate-100 last:border-b-0 hover:bg-primary/5 transition disabled:opacity-50"
            >
              <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900 leading-snug truncate">
                  {s.primary}
                </div>
                {s.secondary && (
                  <div className="text-xs text-slate-500 mt-0.5 leading-snug truncate">
                    {s.secondary}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/*
 * FileTile — preview tile for the Attachments step.
 *
 * Handles three flavours of input:
 *   - image/*  → renders a real thumbnail via URL.createObjectURL +
 *                <img>; a tiny "IMG" badge marks the type.
 *   - video/*  → renders the first frame via <video preload="metadata">
 *                with a Play overlay + "VID" badge. Posters work
 *                out of the box for mp4/mov in Chromium/Safari/Firefox.
 *   - other    → falls back to a generic file icon (rare here — the
 *                picker uses accept="image/*,video/*" so this is just
 *                defence for drag-drop later).
 *
 * Lifecycle: the object URL is created once per file via useMemo and
 * revoked in a cleanup effect so memory doesn't grow when the SPOC
 * adds and removes a bunch of large videos.
 */
function FileTile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  const objectUrl = useMemo(
    () => (isImage || isVideo ? URL.createObjectURL(file) : null),
    [file, isImage, isVideo]
  );
  useEffect(() => {
    if (!objectUrl) return;
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  // Human-readable size: 12.3 KB / 4.2 MB. Files this picker sees are
  // < 100 MB in practice, so we don't bother with GB.
  const sizeLabel = useMemo(() => {
    const kb = file.size / 1024;
    if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
    return `${(kb / 1024).toFixed(kb / 1024 < 10 ? 1 : 0)} MB`;
  }, [file.size]);

  const badge =
    isImage ? { label: 'IMG', cls: 'bg-blue-500/90' }
    : isVideo ? { label: 'VID', cls: 'bg-violet-500/90' }
    : { label: 'FILE', cls: 'bg-slate-500/90' };

  return (
    <div className="relative aspect-square rounded-lg bg-white border border-slate-200 overflow-hidden group">
      {/* Thumb */}
      <div className="absolute inset-0 grid place-items-center bg-slate-100">
        {isImage && objectUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={objectUrl}
            alt={file.name}
            className="w-full h-full object-cover"
          />
        ) : isVideo && objectUrl ? (
          <>
            <video
              src={objectUrl}
              preload="metadata"
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <span className="w-10 h-10 rounded-full bg-white/70 backdrop-blur grid place-items-center shadow-lg">
                <Play className="w-5 h-5 text-slate-900 ml-0.5" />
              </span>
            </div>
          </>
        ) : (
          <FileGeneric className="w-10 h-10 text-slate-300" />
        )}
      </div>

      {/* Type badge top-left */}
      <span className={cn(
        'absolute top-1.5 left-1.5 text-[9px] font-bold tracking-wider text-white px-1.5 py-0.5 rounded',
        badge.cls
      )}>
        {badge.label}
      </span>

      {/* Remove × top-right */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/90 text-slate-700 hover:text-rose-600 hover:bg-white grid place-items-center shadow-sm opacity-0 group-hover:opacity-100 transition"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      {/* Filename + size strip */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent px-2 py-1.5 text-white">
        <div className="text-[11px] font-medium leading-tight truncate" title={file.name}>
          {file.name}
        </div>
        <div className="text-[9px] text-white/80 tracking-wider uppercase">
          {sizeLabel}
        </div>
      </div>
    </div>
  );
}

function StepCard({
  step, icon: Icon, title, subtitle, children,
}: {
  step: number;
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  subtitle: string;
  children: React.ReactNode;
}) {
  // No overflow-hidden — the Service Category dropdown is absolutely
  // positioned inside this card and was being clipped by a parent
  // overflow. The header still looks clean inside the rounded card
  // thanks to its own rounded-t styling.
  // Mobile: tighter px-4/py-3 on header and p-4 on body so the form
  // fields keep more horizontal room on narrow phones.
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm">
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl">
        <div className="relative shrink-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-primary text-white grid place-items-center font-bold text-sm shadow-md shadow-primary/30">
            {step}
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white grid place-items-center ring-2 ring-white">
            <Icon className="w-3 h-3 text-primary" />
          </div>
        </div>
        <div className="min-w-0">
          <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">{title}</h2>
          <p className="text-[11px] sm:text-xs text-slate-500 leading-snug">{subtitle}</p>
        </div>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Field({
  label, required, error, trailing, icon: Icon, dataField, className, children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  trailing?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  dataField?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className} data-field={dataField}>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider inline-flex items-center gap-1.5">
          {Icon && <Icon className="w-3 h-3 text-slate-400" />}
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
        {trailing}
      </div>
      {children}
      {error && (
        <p className="mt-1 text-xs text-rose-600 inline-flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}
    </div>
  );
}

function SummaryRow({
  icon: Icon, label, value, sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex gap-2.5">
      <Icon className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <dt className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</dt>
        <dd className="text-sm text-slate-800 font-medium truncate">{value}</dd>
        {sub && <dd className="text-xs text-slate-500 truncate">{sub}</dd>}
      </div>
    </div>
  );
}

function CategorySelect({
  options, selectedIds, onChange, placeholder, disabled, hasError,
}: {
  options: ServiceCategory[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  placeholder: string;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);
  const selectedOptions = useMemo(
    () => options.filter((o) => selectedSet.has(o.id)),
    [options, selectedSet]
  );

  function toggle(id: number) {
    if (selectedSet.has(id)) onChange(selectedIds.filter((s) => s !== id));
    else onChange([...selectedIds, id]);
  }
  function remove(id: number) { onChange(selectedIds.filter((s) => s !== id)); }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          'input flex items-center gap-1.5 flex-wrap text-left min-h-[40px]',
          'disabled:opacity-60 disabled:cursor-not-allowed',
          hasError && 'ring-1 ring-rose-300'
        )}
      >
        {selectedOptions.length === 0 ? (
          <span className="text-slate-400 flex-1">{placeholder}</span>
        ) : (
          <span className="flex flex-wrap gap-1 flex-1">
            {selectedOptions.map((o) => (
              <span
                key={o.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-100 text-primary text-xs font-semibold"
              >
                {o.name}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); remove(o.id); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); remove(o.id); } }}
                  aria-label={`Remove ${o.name}`}
                  className="hover:text-primary-dark cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </span>
              </span>
            ))}
          </span>
        )}
        <ChevronDown className={cn('w-4 h-4 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg max-h-[420px] flex flex-col">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                type="text"
                className="w-full text-sm rounded border border-slate-200 pl-7 pr-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Search categories…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <ul className="overflow-y-auto flex-1 py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-slate-500 text-center">No matches</li>
            ) : (
              filtered.map((o) => {
                const checked = selectedSet.has(o.id);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => toggle(o.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-primary-50',
                        checked && 'bg-primary-50 text-primary font-semibold'
                      )}
                    >
                      <span className={cn(
                        'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                        checked ? 'bg-primary border-primary text-white' : 'border-slate-300'
                      )}>
                        {checked && <Check className="w-3 h-3" />}
                      </span>
                      <span className="flex-1">{o.name}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {selectedIds.length > 0 && (
            <div className="border-t border-slate-100 px-3 py-2 flex items-center justify-between text-xs text-slate-500">
              <span>{selectedIds.length} selected</span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-primary hover:underline font-semibold"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/*
 * CitySelect — single-select typeahead for the city dropdown on
 * the New Order form. Same pattern as the Reporting Manager picker
 * in the Profile page: type to filter, ↑/↓ to navigate, Enter to
 * select, Esc to close.
 */
function CitySelect({
  cities, value, onChange, hasError,
}: {
  cities: { id: number; name: string }[];
  value: number | null;
  onChange: (id: number | null) => void;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) { setQuery(''); setActive(0); }
  }, [open]);

  const selected = useMemo(
    () => cities.find((c) => c.id === value) ?? null,
    [cities, value]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cities;
    return cities.filter((c) => (c.name || '').toLowerCase().includes(needle));
  }, [cities, query]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function selectId(id: number | null) {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = filtered[active];
      if (hit) selectId(hit.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else setOpen(false);
    }
  }

  const buttonLabel = selected ? selected.name : '— Select a city —';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center justify-between gap-2 pl-3 pr-2 py-2 text-sm border rounded-lg bg-white relative transition outline-none min-h-[40px]',
          open
            ? 'border-primary ring-2 ring-primary/20'
            : hasError
              ? 'border-rose-300 ring-1 ring-rose-300'
              : 'border-slate-200 hover:border-slate-300',
          selected ? 'text-slate-800' : 'text-slate-400'
        )}
      >
        <span className="truncate">{buttonLabel}</span>
        <span className="flex items-center gap-1 shrink-0">
          {selected && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); selectId(null); }}
              className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700"
              aria-label="Clear selection"
              title="Clear"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={cn('w-4 h-4 text-slate-400 transition', open && 'rotate-180')} />
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-[420px] overflow-hidden flex flex-col">
          <div className="relative border-b border-slate-100 p-2">
            <Search className="w-3.5 h-3.5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder="Type to search a city…"
              className="w-full pl-8 pr-2 py-1.5 text-sm border border-slate-200 rounded outline-none focus:border-primary"
            />
          </div>
          <ul ref={listRef} className="flex-1 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-xs text-slate-400 text-center">
                No matches{query ? ` for "${query}"` : ''}.
              </li>
            )}
            {filtered.map((c, i) => {
              const isSelected = c.id === value;
              const isActive = i === active;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => selectId(c.id)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left',
                      isActive ? 'bg-primary/10' : '',
                      isSelected ? 'text-primary font-semibold' : 'text-slate-700'
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{c.name}</span>
                    </span>
                    {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {filtered.length > 8 && (
            <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">
              <kbd className="px-1 rounded bg-slate-100 font-mono">↑↓</kbd> navigate ·{' '}
              <kbd className="px-1 rounded bg-slate-100 font-mono">Enter</kbd> select ·{' '}
              <kbd className="px-1 rounded bg-slate-100 font-mono">Esc</kbd> close
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/*
 * SuccessModal — celebratory confirmation shown after the backend
 * returns a job_id. Click OK closes the modal and the parent
 * redirects to /dashboard.
 */
function SuccessModal({
  jobId, onClose,
}: {
  jobId: number;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 grid place-items-center mb-3">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-1">Success!</h3>
        <p className="text-sm text-slate-600 mb-1">Booked a Request Successfully</p>
        <p className="text-sm text-slate-800 font-semibold mb-5">
          Job ID: <span className="text-primary">{jobId}</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          className="btn-primary w-full justify-center"
          autoFocus
        >
          OK
        </button>
      </div>
    </div>
  );
}

/*
 * SelectAddressDialog — "Select Address" picker (image 2 in the brief).
 *
 * First step of the two-step address flow:
 *   1. Customer mobile is already on the form → we look up the
 *      customer's address book via
 *      GET /api/client/customers/mobile/:mobile/addresses
 *      (scoped to the SPOC's own client, so we never leak addresses
 *      from another brand's bookings).
 *   2. SPOC picks one of the saved cards → onPickSaved fills the form.
 *   3. OR clicks "Use current location" → browser geolocation fires,
 *      onUseCurrentLocation forwards GPS to the Add-Details popup.
 *   4. OR clicks "Add new" (when empty / when the search has no hit)
 *      → onAddNew opens a blank Add-Details popup.
 *
 * Search filters the saved list client-side for now. Wiring it to
 * Google Places Autocomplete would require the SPOC-scoped maps proxy
 * the user said not to add — easy follow-up if requested later.
 */
type SavedAddress = {
  address_id: number;
  address: string | null;
  building: string | null;
  landmark: string | null;
  locality: string | null;
  city_id: number | null;
  city_name?: string | null;
  pin_code: string | null;
  gps_location: string | null;
  mobile_number: string | null;
};

type PlacePrefill = {
  address?: string;
  city_id?: number | null;
  pin_code?: string;
  gps_location?: string;
};
type PlaceSuggestion = {
  place_id: string;
  description: string;
  primary: string;
  secondary: string;
};

function SelectAddressDialog({
  customerMobile, cities, onClose, onPickSaved, onAddNew, onUseCurrentLocation, onPickPlace,
}: {
  customerMobile: string;
  cities: { id: number; name: string }[];
  onClose: () => void;
  onPickSaved: (a: SavedAddress) => void;
  onAddNew: () => void;
  onUseCurrentLocation: (gps: string) => void;
  onPickPlace: (prefill: PlacePrefill) => void;
}) {
  const [items, setItems] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google Places autocomplete state. `suggestions` are remote results
  // fired off after the SPOC types 3+ chars (debounced 300ms). They
  // render above the saved-addresses list so the SPOC sees fresh
  // Google matches first.
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [acLoading, setAcLoading] = useState(false);
  const [resolving, setResolving] = useState(false); // true while we geocode a picked suggestion

  useEffect(() => {
    let cancelled = false;
    if (!/^\d{10}$/.test(customerMobile)) {
      setItems([]);
      return;
    }
    setLoading(true); setError(null);
    api.get<{ items: SavedAddress[] }>(`/customers/mobile/${customerMobile}/addresses`)
      .then((res) => { if (!cancelled) setItems(res.items || []); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load addresses'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [customerMobile]);

  // Debounced Places Autocomplete. <3 chars or empty → clear. >=3
  // chars → wait 300ms, then call /maps/autocomplete. AbortController
  // prevents stale responses from clobbering a newer query.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setSuggestions([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setAcLoading(true);
      try {
        const res = await api.get<{ items: PlaceSuggestion[] }>(
          `/maps/autocomplete?q=${encodeURIComponent(q)}`,
          { signal: ctl.signal }
        );
        setSuggestions(res.items || []);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          // Don't blow up the modal — leave the saved list usable and
          // show a small note.
          setSuggestions([]);
        }
      } finally {
        setAcLoading(false);
      }
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((a) => {
      const hay = [a.address, a.building, a.landmark, a.city_name, a.pin_code]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  function fireGeolocation() {
    if (!navigator.geolocation) {
      setError('Geolocation not available in this browser');
      return;
    }
    setLocating(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const gps = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
        setLocating(false);
        onUseCurrentLocation(gps);
      },
      (err) => {
        setError(err.message || 'Could not get your location');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  /*
   * SPOC clicked a Google suggestion → geocode its place_id to fetch
   * lat/lng + formatted_address + components, then bubble all of it
   * up via onPickPlace so the Add Details popup opens prefilled.
   */
  async function pickSuggestion(s: PlaceSuggestion) {
    setResolving(true); setError(null);
    try {
      type GeocodeResponse = {
        lat: number | null;
        lng: number | null;
        formatted_address: string;
        address_components: {
          postal_code?: string;
          city?: string;
        };
      };
      const out = await api.get<GeocodeResponse>(
        `/maps/geocode?place_id=${encodeURIComponent(s.place_id)}`
      );
      const gps = (out.lat != null && out.lng != null)
        ? `${Number(out.lat).toFixed(6)},${Number(out.lng).toFixed(6)}`
        : '';
      const pin = String(out.address_components?.postal_code || '').replace(/\D/g, '').slice(0, 6);
      const rawCity = String(out.address_components?.city || '').toLowerCase();
      let matchedId: number | null = null;
      if (rawCity) {
        const exact = cities.find((c) => (c.name || '').toLowerCase() === rawCity);
        if (exact) matchedId = exact.id;
        else {
          const partial = cities.find((c) => {
            const n = (c.name || '').toLowerCase();
            return n.includes(rawCity) || rawCity.includes(n);
          });
          if (partial) matchedId = partial.id;
        }
      }
      onPickPlace({
        address:      out.formatted_address || s.description,
        gps_location: gps,
        pin_code:     pin,
        city_id:      matchedId,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resolve that place');
    } finally {
      setResolving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm px-0 sm:px-4 py-0 sm:py-8 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl overflow-hidden sm:my-auto max-h-[95vh] sm:max-h-none flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 flex items-center justify-between border-b border-slate-100 shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">Select Address</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full grid place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* Search bar with right-side spinner */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input w-full pl-9 pr-10"
              placeholder="Search for a location (try “Ambience Mall” or “Sector 44 Gurgaon”)"
            />
            {acLoading && (
              <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
            )}
          </div>

          {/* Google Places suggestions — only when there's a query */}
          {query.trim().length >= 3 && (
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-2 inline-flex items-center gap-1.5">
                <span>Suggestions</span>
                <span className="text-[9px] font-medium text-slate-400 normal-case tracking-normal">
                  powered by Google
                </span>
              </h3>
              {suggestions.length === 0 && !acLoading && (
                <div className="py-3 text-center text-xs text-slate-400">
                  No places matched “{query}”.
                </div>
              )}
              {suggestions.length > 0 && (
                <ul className="space-y-1 max-h-56 overflow-y-auto pr-1">
                  {suggestions.map((s) => (
                    <li key={s.place_id}>
                      <button
                        type="button"
                        onClick={() => pickSuggestion(s)}
                        disabled={resolving}
                        className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:border-primary hover:bg-primary/5 transition disabled:opacity-50"
                      >
                        <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900 leading-snug truncate">
                            {s.primary}
                          </div>
                          {s.secondary && (
                            <div className="text-xs text-slate-500 mt-0.5 leading-snug truncate">
                              {s.secondary}
                            </div>
                          )}
                        </div>
                        {resolving && (
                          <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin mt-1 shrink-0" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Use current location */}
          <button
            type="button"
            onClick={fireGeolocation}
            disabled={locating}
            className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-emerald-50 transition disabled:opacity-50"
          >
            <span className="w-10 h-10 rounded-full bg-emerald-50 ring-1 ring-emerald-200 grid place-items-center shrink-0">
              {locating
                ? <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
                : <Crosshair className="w-5 h-5 text-emerald-600" />}
            </span>
            <span className="font-bold text-slate-900">
              {locating ? 'Getting your location…' : 'Use current location'}
            </span>
          </button>

          {error && (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 inline-flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          {/* Saved address list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Saved Address
              </h3>
              <button
                type="button"
                onClick={onAddNew}
                className="text-xs font-semibold text-primary hover:text-primary-dark inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add new
              </button>
            </div>

            {loading && (
              <div className="py-6 text-center text-sm text-slate-500 inline-flex items-center justify-center gap-2 w-full">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading saved addresses…
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-500">
                {items.length === 0
                  ? (/^\d{10}$/.test(customerMobile)
                      ? 'No saved addresses for this customer yet.'
                      : 'Enter a customer mobile first to load saved addresses.')
                  : `No saved address matches "${query}".`}
              </div>
            )}

            {!loading && filtered.length > 0 && (
              <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {filtered.map((a) => {
                  // Heuristic icon — Office for buildings with bldg
                  // hint, Home otherwise. SPOC can re-categorise via
                  // address_type in the next step.
                  const Icon = /office|tower|plot|sector|udyog|industri/i.test(a.building || a.address || '')
                    ? Briefcase
                    : Home;
                  const line1 = [a.building, a.address].filter(Boolean).join(', ');
                  const line2 = [a.city_name, a.pin_code, 'India'].filter(Boolean).join(', ');
                  return (
                    <li key={a.address_id}>
                      <button
                        type="button"
                        onClick={() => onPickSaved(a)}
                        className="w-full text-left flex items-start gap-3 px-3 py-3 rounded-xl border border-slate-200 bg-white hover:border-primary hover:bg-primary/5 transition"
                      >
                        <Icon className="w-5 h-5 text-slate-500 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900 leading-snug">
                            {line1 || '—'}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 leading-snug">
                            {line2}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/*
 * AddressDialog — "Add Address Details" popup.
 *
 * Single modal that captures everything tbl_address needs (address,
 * building, landmark, city_id, pin_code, gps_location, mobile_number)
 * plus an FE-only address_type tag (Home/Office/Other) that's
 * prepended to the address text on submit. Mirrors the legacy
 * popup-driven flow with a google.com/maps embed showing the pin
 * coordinates and a "Use my location" button (browser geolocation API,
 * no Google API key required).
 *
 * Why iframe + browser geolocation instead of an interactive Maps JS
 * widget: the backend's maps proxy is token-gated for magic-link
 * sessions, and the user asked for zero backend changes here. An
 * embed iframe + navigator.geolocation gives a visible map preview
 * and one-click "current location" without needing the public API
 * key exposed to this page. Drag-to-pin can be added later if ops
 * want it — just swap the iframe for `@react-google-maps/api`.
 */
function AddressDialog({
  initial, cities, onClose, onSave,
}: {
  initial: {
    address: string;
    city_id: number | null;
    pin_code: string;
    building: string;
    landmark: string;
    gps_location: string;
    address_type: 'Home' | 'Office' | 'Other' | '';
  };
  cities: { id: number; name: string }[];
  onClose: () => void;
  onSave: (v: typeof initial) => void;
}) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  function update<K extends keyof typeof v>(key: K, val: (typeof v)[K]) {
    setV((s) => ({ ...s, [key]: val }));
  }

  function saveAndClose() {
    if (!v.address.trim()) { setError('Address is required'); return; }
    if (!v.city_id) { setError('Please pick a city'); return; }
    onSave(v);
  }

  /*
   * Auto-geocode when GPS lands but the descriptive fields are blank.
   * Covers two flows:
   *   1. SPOC picked a saved address whose row only has gps_location
   *      saved (older bookings) — we look up the rest.
   *   2. SPOC pasted lat,lng manually — same lookup fires.
   * Guards:
   *   - Only runs when address / pin_code / city_id are ALL empty so a
   *     partially-typed entry isn't overwritten.
   *   - Debounced 600ms so typing GPS doesn't fire requests per
   *     keystroke.
   *   - One-shot per coordinate via `lastGeocodedRef` so re-rendering
   *     doesn't re-fire.
   */
  const lastGeocodedRef = useRef<string>('');
  useEffect(() => {
    const gps = v.gps_location.trim();
    if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(gps)) return;
    if (gps === lastGeocodedRef.current) return;
    // Only auto-fill when the SPOC clearly hasn't typed anything yet.
    if (v.address.trim() || v.pin_code.trim() || v.city_id) return;

    const t = setTimeout(async () => {
      lastGeocodedRef.current = gps;
      setGeocoding(true); setError(null);
      try {
        type GeocodeResponse = {
          formatted_address: string;
          address_components: {
            postal_code?: string;
            city?: string;
            state?: string;
            country?: string;
            sublocality?: string;
          };
        };
        const out = await api.get<GeocodeResponse>(
          `/maps/reverse-geocode?latlng=${encodeURIComponent(gps)}`
        );
        const display = String(out.formatted_address || '');
        const pin = String(out.address_components?.postal_code || '').replace(/\D/g, '').slice(0, 6);
        const rawCity = String(out.address_components?.city || '').toLowerCase();
        let matchedId: number | null = null;
        if (rawCity) {
          // Gurgaon ↔ Gurugram, Bengaluru ↔ Bangalore tolerance.
          const exact = cities.find((c) => (c.name || '').toLowerCase() === rawCity);
          if (exact) matchedId = exact.id;
          else {
            const partial = cities.find((c) => {
              const n = (c.name || '').toLowerCase();
              return n.includes(rawCity) || rawCity.includes(n);
            });
            if (partial) matchedId = partial.id;
          }
        }
        // Only fill fields that are still empty — don't clobber any
        // value the SPOC may have typed in the meantime.
        setV((s) => ({
          ...s,
          address:  s.address.trim()  ? s.address  : display,
          pin_code: s.pin_code.trim() ? s.pin_code : pin,
          city_id:  s.city_id         ? s.city_id  : matchedId,
        }));
      } catch (err) {
        setError(err instanceof ApiError
          ? `Could not look up address: ${err.message}`
          : 'Reverse-geocode failed — please fill the rest manually.');
      } finally {
        setGeocoding(false);
      }
    }, 600);

    return () => clearTimeout(t);
  // Only re-run when the GPS string actually changes — adding the
  // other deps would cause this to re-fire mid-typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.gps_location]);

  // Map src — when gps_location is set, point the iframe there.
  // Otherwise show a search for the typed address. Fallback: India.
  const mapSrc = useMemo(() => {
    if (v.gps_location.trim()) {
      const [lat, lng] = v.gps_location.split(',').map((s) => s.trim());
      if (lat && lng) {
        return `https://www.google.com/maps?q=${encodeURIComponent(lat + ',' + lng)}&z=16&output=embed`;
      }
    }
    if (v.address.trim()) {
      return `https://www.google.com/maps?q=${encodeURIComponent(v.address)}&z=15&output=embed`;
    }
    return `https://www.google.com/maps?q=India&z=5&output=embed`;
  }, [v.gps_location, v.address]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm px-0 sm:px-4 py-0 sm:py-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl overflow-hidden sm:my-auto flex flex-col max-h-[95vh] sm:max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── Header — gradient strip + soft icon tile ──────────── */}
        <div className="relative px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 bg-gradient-to-r from-primary/5 via-white to-white">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary via-primary-dark to-primary" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
                <MapPinned className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight truncate">
                  Add Address Details
                </h2>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 hidden sm:block">
                  Where should the technician be dispatched?
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full grid place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ─── Body — split: form (left) + map (right) ──────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
            {/* LEFT — form fields */}
            <div className="lg:col-span-3 p-4 sm:p-6 space-y-5">
              {/* SECTION 1: Location */}
              <div>
                <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-primary mb-2">
                  <span className="w-5 h-px bg-primary" /> Location
                </div>

                <div className="space-y-3">
                  <DialogField label="Complete Address" required icon={MapPinned}>
                    <PlacesAutocomplete
                      value={v.address}
                      onTextChange={(text) => update('address', text)}
                      geocoding={geocoding}
                      onPickPlace={async (placeId, description) => {
                        // SPOC picked a Google suggestion → resolve to
                        // lat/lng + components, then fill all relevant
                        // fields in one go. building / landmark /
                        // address_type stay as the SPOC typed them.
                        try {
                          type Geo = {
                            lat: number | null;
                            lng: number | null;
                            formatted_address: string;
                            address_components: { postal_code?: string; city?: string };
                          };
                          const out = await api.get<Geo>(
                            `/maps/geocode?place_id=${encodeURIComponent(placeId)}`
                          );
                          const gps = (out.lat != null && out.lng != null)
                            ? `${Number(out.lat).toFixed(6)},${Number(out.lng).toFixed(6)}`
                            : '';
                          const pin = String(out.address_components?.postal_code || '')
                            .replace(/\D/g, '').slice(0, 6);
                          const rawCity = String(out.address_components?.city || '').toLowerCase();
                          let cityId: number | null = null;
                          if (rawCity) {
                            const exact = cities.find((c) => (c.name || '').toLowerCase() === rawCity);
                            if (exact) cityId = exact.id;
                            else {
                              const partial = cities.find((c) => {
                                const n = (c.name || '').toLowerCase();
                                return n.includes(rawCity) || rawCity.includes(n);
                              });
                              if (partial) cityId = partial.id;
                            }
                          }
                          setV((s) => ({
                            ...s,
                            address:      out.formatted_address || description,
                            gps_location: gps,
                            pin_code:     pin || s.pin_code,
                            city_id:      cityId ?? s.city_id,
                          }));
                          // Bypass the auto-geocode-on-GPS-change effect
                          // for this coordinate — we already have the
                          // address from the Place result.
                          lastGeocodedRef.current = gps;
                        } catch (err) {
                          setError(err instanceof ApiError
                            ? `Could not resolve place: ${err.message}`
                            : 'Could not resolve that place');
                        }
                      }}
                    />
                  </DialogField>

                  <div className="grid grid-cols-3 gap-3">
                    <DialogField label="GPS" required icon={Crosshair}>
                      <input
                        type="text"
                        // h-10 + rounded-lg so GPS/Pincode match the City
                        // control's height & radius — all three uniform.
                        className="input w-full h-10 rounded-lg font-mono"
                        value={v.gps_location}
                        onChange={(e) => update('gps_location', e.target.value)}
                        placeholder="lat, lng"
                      />
                    </DialogField>
                    <DialogField label="Pincode" required icon={Hash}>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        className="input w-full h-10 rounded-lg"
                        value={v.pin_code}
                        onChange={(e) => update('pin_code', e.target.value.replace(/\D/g, ''))}
                        placeholder="6-digit"
                      />
                    </DialogField>
                    <DialogField label="City" required icon={MapPin}>
                      <CitySelect
                        cities={cities}
                        value={v.city_id}
                        onChange={(id) => update('city_id', id)}
                        hasError={false}
                      />
                    </DialogField>
                  </div>
                </div>
              </div>

              {/* SECTION 2: Property details */}
              <div>
                <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-primary mb-2">
                  <span className="w-5 h-px bg-primary" /> Property Details
                </div>

                <div className="space-y-3">
                  <DialogField label="Society, Flat, Floor, Block Name" required icon={Building}>
                    <input
                      type="text"
                      className="input w-full"
                      value={v.building}
                      onChange={(e) => update('building', e.target.value)}
                      placeholder="e.g. ChannelPlay, Block A, Floor 3"
                    />
                  </DialogField>

                  <DialogField label="Nearby Landmark" icon={MapPin}>
                    <input
                      type="text"
                      className="input w-full"
                      value={v.landmark}
                      onChange={(e) => update('landmark', e.target.value)}
                      placeholder="e.g. Opposite Big Bazaar"
                    />
                  </DialogField>
                </div>
              </div>

              {/* SECTION 3: Type pills */}
              <div>
                <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-primary mb-2">
                  <span className="w-5 h-px bg-primary" /> Address Type <span className="text-rose-500">*</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'Home',   label: 'Home',   Icon: Home,      tone: 'emerald' },
                    { key: 'Office', label: 'Office', Icon: Briefcase, tone: 'blue' },
                    { key: 'Other',  label: 'Other',  Icon: Building,  tone: 'amber' },
                  ] as const).map(({ key, label, Icon, tone }) => {
                    const on = v.address_type === key;
                    const onClass =
                      tone === 'emerald' ? 'border-emerald-400 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : tone === 'blue'  ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                      : 'border-amber-400 bg-amber-50 text-amber-700 ring-1 ring-amber-200';
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => update('address_type', key)}
                        className={cn(
                          'rounded-xl border-2 p-3 flex flex-col items-center gap-1.5 transition',
                          on
                            ? onClass + ' shadow-sm scale-[1.02]'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                        )}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="text-xs font-bold">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 inline-flex items-center gap-2 w-full">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                </div>
              )}
            </div>

            {/* RIGHT — map + use-location CTA (sticky on desktop) */}
            <div className="lg:col-span-2 bg-slate-50 lg:border-l lg:border-slate-100 p-4 sm:p-6">
              <div className="lg:sticky lg:top-0 space-y-3">
                <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                  <span className="w-5 h-px bg-primary" /> Map Preview
                </div>

                <div className="rounded-xl overflow-hidden border border-slate-200 bg-white shadow-sm">
                  <iframe
                    title="Location preview"
                    src={mapSrc}
                    className="w-full h-48 sm:h-64 lg:h-[420px] border-0"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>

                <p className="text-[11px] text-slate-500 leading-snug">
                  The map updates as you type the address or paste GPS coordinates.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Sticky footer ────────────────────────────────────── */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-100 bg-white flex items-center justify-between gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="text-[11px] sm:text-xs text-slate-500 shrink-0">
            <span className="text-rose-500">*</span> required
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 sm:px-4 rounded-md text-sm font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveAndClose}
              className="px-4 py-2 sm:px-6 rounded-md text-sm font-semibold text-white bg-primary hover:bg-primary-dark shadow-sm shadow-primary/30 inline-flex items-center gap-1.5"
            >
              Continue <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/*
 * DialogField — small label + icon + child input shell used by the
 * Add Address Details popup. Keeps every field's chrome consistent
 * (uppercase label, brand icon, slate-400 hint).
 */
function DialogField({
  label, required, icon: Icon, children,
}: {
  label: string;
  required?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1 inline-flex items-center gap-1">
        <Icon className="w-3 h-3 text-slate-400" />
        {label}
        {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function AlternateModal({
  name: initialName, number: initialNumber, error, onClose, onSave,
}: {
  name: string;
  number: string;
  error?: string;
  onClose: () => void;
  onSave: (name: string, number: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [number, setNumber] = useState(initialNumber);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900 inline-flex items-center gap-2">
            <Phone className="w-4 h-4 text-primary" />
            Add alternate number
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-500 hover:text-slate-900 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-1.5">
              Alternate contact name
            </label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-1.5">
              Alternate contact no.
            </label>
            <input
              className={cn('input', error && 'ring-1 ring-rose-300')}
              inputMode="numeric"
              maxLength={10}
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))}
              placeholder="10-digit mobile"
            />
            {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline">Cancel</button>
          <button
            type="button"
            onClick={() => onSave(name.trim(), number.trim())}
            className="btn-primary"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
