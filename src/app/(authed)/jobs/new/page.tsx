'use client';

/*
 * "Book a technician" — redesigned 2026-05-30.
 *
 * Layout shift from v1:
 *   - Hero card with brand-red stripe + friendly greeting
 *   - Three NUMBERED section cards (Customer / Location / Attachments)
 *     each with a step circle + icon so the form scans like a wizard
 *     without forcing pagination
 *   - Sticky live SUMMARY rail on desktop (right side) — updates as
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
import { useRouter } from 'next/navigation';
import {
  Plus, X, AlertCircle, ChevronDown, Search, Check, Loader2,
  User, MapPin, Camera, Hash, ChevronRight,
  Phone, Briefcase, FileText, CreditCard, Sparkles, AlertTriangle,
  Tag, ClipboardList, ImageIcon as ImageLucide,
  Calendar, Clock, CheckCircle2,
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
  address: string;
  city_id: number | null;              // required by backend insertAddress
  pin_code: string;
  client_ref_id: string;
  notes: string;
  custom_props: Record<string, string>;
  // Inline appointment — replaces the old popup. SPOC picks date +
  // slot as part of the form, Book Now submits everything.
  appt_date: string;                   // YYYY-MM-DD
  appt_slot: TimeSlot | '';
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
  client_ref_id: '',
  notes: '',
  custom_props: {},
  appt_date: '',
  appt_slot: '',
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

function isTenDigits(v: string) {
  return /^[6-9]\d{9}$/.test(v.trim());
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
  const requiredChecks = useMemo(() => {
    const checks: { key: string; label: string; ok: boolean }[] = [
      { key: 'customer_mob_no', label: 'Customer mobile',  ok: isTenDigits(form.customer_mob_no) },
      { key: 'customer_name',   label: 'Contact name',     ok: form.customer_name.trim().length > 0 },
      { key: 'service_category_ids', label: 'Service category', ok: form.service_category_ids.length > 0 },
      { key: 'job_desc',        label: 'Problem description', ok: form.job_desc.trim().length > 0 },
      { key: 'address',         label: 'Address',          ok: form.address.trim().length > 0 },
      { key: 'client_ref_id',   label: 'Order reference ID', ok: form.client_ref_id.trim().length > 0 },
    ];
    customProps.filter((cp) => cp.mandatory).forEach((cp) => {
      checks.push({
        key: `cp_${cp.name}`,
        label: cp.label || humanize(cp.name),
        ok: (form.custom_props[cp.name] ?? '').trim().length > 0,
      });
    });
    return checks;
  }, [form, customProps]);

  const filledCount = requiredChecks.filter((c) => c.ok).length;
  const allRequiredOk = filledCount === requiredChecks.length;

  // Returns the errors map so callers can use it immediately
  // (setFieldErrors is async — reading state right after won't reflect
  // the new value).
  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!form.customer_mob_no.trim()) errs.customer_mob_no = 'Mobile number is required';
    else if (!isTenDigits(form.customer_mob_no)) errs.customer_mob_no = 'Enter a valid 10-digit mobile';
    if (!form.customer_name.trim()) errs.customer_name = 'Contact name is required';
    if (form.service_category_ids.length === 0) errs.service_category_ids = 'Pick at least one service category';
    if (!form.job_desc.trim()) errs.job_desc = 'Describe the problem';
    if (!form.address.trim()) errs.address = 'Address is required';
    if (!form.city_id)        errs.city_id = 'Pick a city';
    if (!form.client_ref_id.trim()) errs.client_ref_id = "Brand's order reference ID is required";
    if (form.alternate_mob_no && !isTenDigits(form.alternate_mob_no)) {
      errs.alternate_mob_no = 'Enter a valid 10-digit alternate mobile';
    }
    if (!form.appt_date)      errs.appt_date = 'Pick an appointment date';
    else if (form.appt_date < todayLocalISO()) errs.appt_date = 'Appointment date cannot be in the past';
    if (!form.appt_slot)      errs.appt_slot = 'Pick a time slot';
    customProps.forEach((cp) => {
      if (cp.mandatory && !(form.custom_props[cp.name] ?? '').trim()) {
        errs[`cp_${cp.name}`] = `${cp.label || humanize(cp.name)} is required`;
      }
    });
    setFieldErrors(errs);
    return errs;
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
          address:    form.address.trim(),
          city_id:    form.city_id,
          pin_code:   form.pin_code || '',
          building:   undefined,
          landmark:   undefined,
          locality:   undefined,
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
        remarks: form.notes.trim() || null,
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
    <form onSubmit={submit} className="max-w-6xl mx-auto pb-28">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-slate-500 mb-3">
        <Link href="/dashboard" className="hover:text-primary">Dashboard</Link>
        <ChevronRight className="w-3 h-3 text-slate-300" />
        <span className="font-semibold text-slate-800">New Order</span>
      </div>

      {/* Hero card with brand-red side stripe */}
      <div className="relative bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-5">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary via-primary-dark to-primary" />
        <div className="p-5 md:p-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 inline-flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Hello {firstNameOf(spoc.contact_name) || 'there'} 👋
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Tell us about the work and we&apos;ll dispatch a technician right away.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-semibold">
            <ClipboardList className="w-4 h-4" />
            {filledCount} / {requiredChecks.length} required filled
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 flex items-start gap-2 mb-5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Two-column on desktop: form (left) + sticky summary (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">

        {/* ─── LEFT: form sections ───────────────────────────── */}
        <div className="space-y-5 min-w-0">

          {/* STEP 1 — Customer & Service */}
          <StepCard step={1} icon={User} title="Customer &amp; Service"
            subtitle="Who needs the technician and what kind of work?">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Customer mobile" required
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
                label="Contact name" required
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

              <Field
                label="Service category" required
                error={fieldErrors.service_category_ids}
                icon={Briefcase}
                className="md:col-span-2"
                dataField="service_category_ids"
              >
                <CategorySelect
                  options={categories}
                  selectedIds={form.service_category_ids}
                  onChange={(ids) => setField('service_category_ids', ids)}
                  placeholder={
                    categories.length === 0
                      ? 'No categories configured for your account'
                      : 'Pick one or more — search by name'
                  }
                  disabled={categories.length === 0}
                  hasError={!!fieldErrors.service_category_ids}
                />
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

          {/* STEP 2 — Service Location */}
          <StepCard step={2} icon={MapPin} title="Service Location"
            subtitle="Where should the technician go?">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Address for technician" required
                error={fieldErrors.address}
                icon={MapPin}
                className="md:col-span-2"
                dataField="address"
              >
                <textarea
                  rows={3}
                  className={cn('input resize-y', fieldErrors.address && 'ring-1 ring-rose-300')}
                  value={form.address}
                  onChange={(e) => setField('address', e.target.value)}
                  placeholder="Flat / Building / Street / Landmark"
                />
              </Field>

              <Field
                label="City" required
                error={fieldErrors.city_id}
                icon={MapPin}
                dataField="city_id"
              >
                <CitySelect
                  cities={cities}
                  value={form.city_id}
                  onChange={(id) => setField('city_id', id)}
                  hasError={!!fieldErrors.city_id}
                />
              </Field>

              <Field label="PIN code" icon={Hash}>
                <input
                  className="input"
                  inputMode="numeric"
                  maxLength={6}
                  value={form.pin_code}
                  onChange={(e) => setField('pin_code', e.target.value.replace(/\D/g, ''))}
                  placeholder="6-digit PIN"
                />
              </Field>

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

          {/* STEP 4 — Attachments */}
          <StepCard step={4} icon={Camera} title="Attachments"
            subtitle="Optional — photos or videos that help the technician prepare.">
            <div className={cn(
              'rounded-xl border-2 border-dashed p-5 transition',
              files.length > 0 ? 'border-primary/30 bg-primary-50/30' : 'border-slate-200 bg-slate-50/40'
            )}>
              {files.length === 0 ? (
                <div className="text-center py-4">
                  <ImageLucide className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500 mb-3">No files attached yet.</p>
                  <label className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-primary-dark transition shadow-sm">
                    <Plus className="w-4 h-4" /> Add Files
                    <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={onPickFiles} />
                  </label>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-3">
                    {files.map((f, i) => (
                      <div
                        key={`${f.name}-${i}`}
                        className="aspect-square rounded-lg bg-white border border-slate-200 p-2 flex flex-col justify-between text-xs"
                      >
                        <div className="flex-1 grid place-items-center text-slate-400">
                          <ImageLucide className="w-8 h-8" />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="truncate flex-1 text-slate-700" title={f.name}>
                            {f.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFile(i)}
                            aria-label={`Remove ${f.name}`}
                            className="text-slate-400 hover:text-rose-600 shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
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

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-0 left-0 lg:left-64 right-0 z-30 bg-white border-t border-slate-200 shadow-xl">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center justify-end gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="hidden sm:inline-flex text-sm text-slate-600 hover:text-primary underline-offset-2 hover:underline px-2"
            >
              Reset
            </button>
            <Link href="/dashboard" className="btn-outline">Cancel</Link>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Booking…</>
                : <>Book Now <ChevronRight className="w-4 h-4" /></>}
            </button>
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
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl">
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-xl bg-primary text-white grid place-items-center font-bold text-sm shadow-md shadow-primary/30">
            {step}
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white grid place-items-center ring-2 ring-white">
            <Icon className="w-3 h-3 text-primary" />
          </div>
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="p-5">{children}</div>
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
