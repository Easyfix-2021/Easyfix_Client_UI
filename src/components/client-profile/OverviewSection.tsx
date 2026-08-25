'use client';

/*
 * Client Profile → Overview (portal).
 *
 * Your company as EasyFix holds it, split down the middle by WHO OWNS EACH
 * FIELD rather than by topic:
 *
 *   YOURS      registered address, contact email, the name on your invoices,
 *              and your KYC / brand files. Editable in place by a SPOC who
 *              speaks for the whole company.
 *   EASYFIX'S  booking cut-off, who collects on a job, your reference code,
 *              travel radius, order cap, invoice cycle. Shown, labelled, and
 *              read-only — these are agreement terms, not preferences.
 *
 * `canEdit` and `editable` come from the SERVER (GET /company resolves them
 * from the same gate the PUT applies). Never re-derive them here from the
 * role: the two would drift the first time the gate moved, and the direction
 * that drifts is always "shows an input that 403s on save".
 *
 * ─── TWO COMP LABELS THAT MEAN SOMETHING ELSE HERE ──────────────────────────
 *   "Booking cut-off: 4:00 PM"  → booking_cut_off is a number of HOURS of lead
 *     time (capped at 48) that dispatch consumes as hours. Rendered as hours.
 *   "Collected by (EasyFix staff): Aditi Rao" → collected_by is a three-value
 *     enum for which PARTY collects on a job, not a person. The comp's intent —
 *     "who at EasyFix looks after us" — is real and lives one row down as Your
 *     EasyFix SPOC, from /support-contacts. Both are shown, separately, because
 *     they are genuinely two facts.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Save, ShieldCheck, UserCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useFetchOnce } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { DocumentChecklist } from './DocumentChecklist';
import { Chip, Fact, FactGrid, ManagedByEasyFix, SectionShell } from './shell';
import type { Company, SupportContacts } from './types';

type FormState = {
  clientEmail: string;
  clientAddress: string;
  building: string;
  landmark: string;
  pincode: string;
  billingName: string;
};

const str = (v: unknown) => (v == null ? '' : String(v));

function seed(c: Company): FormState {
  return {
    clientEmail: str(c.email),
    clientAddress: str(c.address),
    building: str(c.building),
    landmark: str(c.landmark),
    pincode: str(c.pincode),
    billingName: str(c.billingName),
  };
}

export function OverviewSection({
  company, onSaved,
}: {
  company: Company;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => seed(company));
  const [snapshot, setSnapshot] = useState<FormState>(() => seed(company));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-seed whenever the row is refetched, so a save elsewhere on the page
  // cannot leave this form showing stale values.
  useEffect(() => {
    const next = seed(company);
    setForm(next);
    setSnapshot(next);
  }, [company]);

  const { data: support } = useFetchOnce<SupportContacts>('/support-contacts');
  const easyfixSpoc = support?.primary?.[0] ?? null;

  const canEdit = company.canEdit;
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(snapshot), [form, snapshot]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save() {
    if (!canEdit || saving) return;
    if (form.pincode && !/^[0-9]{6}$/.test(form.pincode)) {
      setError('Pincode must be 6 digits.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      /*
       * Only the CHANGED keys are sent. The endpoint rejects unknown keys
       * rather than stripping them, so sending the whole form would be fine —
       * but a diff keeps the audit line in the server log meaningful ("fields=
       * billingName" rather than every field on every save).
       */
      const payload: Record<string, string> = {};
      (Object.keys(form) as Array<keyof FormState>).forEach((k) => {
        if (form[k] !== snapshot[k]) payload[k] = form[k];
      });
      if (Object.keys(payload).length === 0) return;
      await api.put('/company', payload);
      setSnapshot(form);
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not save those changes.');
    } finally { setSaving(false); }
  }

  return (
    <SectionShell
      title="Overview"
      note={canEdit
        ? 'Your company as EasyFix holds it. Edit the fields you own, then save.'
        : 'Your company as EasyFix holds it.'}
      action={company.status === 1
        ? <Chip tone="success">Active</Chip>
        : <Chip tone="danger">Inactive</Chip>}
    >
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
        {/* ── Left: the company ─────────────────────────────────── */}
        <div className="space-y-6">
          {/* Names */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink-900">How Your Name Appears</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ReadOnlyField label="Client Name" value={company.clientName} />
              <ReadOnlyField label="CRM Display Name" value={company.displayName}
                hint="How EasyFix staff see you in their console." />
              <EditableField
                label="Billing Name"
                hint="The name printed on your invoices."
                value={form.billingName}
                onChange={(v) => set('billingName', v)}
                canEdit={canEdit}
                maxLength={255}
              />
              <ReadOnlyField label="Technician-App Name" value={company.techAppName}
                hint="The short name your technicians see on a job card." />
            </div>
          </div>

          {/* Contact + address — the fields you own */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink-900">Contact & Registered Address</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <EditableField
                label="Email" type="email" value={form.clientEmail}
                onChange={(v) => set('clientEmail', v)} canEdit={canEdit} maxLength={255}
              />
              <ReadOnlyField label="City" value={company.city?.name ?? null}
                hint="Ask your EasyFix SPOC to move your registered city." />
            </div>
            <EditableTextArea
              label="Registered Address" value={form.clientAddress}
              onChange={(v) => set('clientAddress', v)} canEdit={canEdit} maxLength={500}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <EditableField label="Building" value={form.building}
                onChange={(v) => set('building', v)} canEdit={canEdit} maxLength={200} />
              <EditableField label="Landmark" value={form.landmark}
                onChange={(v) => set('landmark', v)} canEdit={canEdit} maxLength={200} />
              <EditableField label="Pincode" value={form.pincode} inputMode="numeric"
                onChange={(v) => set('pincode', v.replace(/\D/g, '').slice(0, 6))}
                canEdit={canEdit} maxLength={6} />
            </div>
          </div>

          {/* Save bar */}
          {canEdit && (
            <div className="flex items-center gap-3 flex-wrap border-t border-ink-100 pt-4">
              <button
                type="button" onClick={save} disabled={!dirty || saving}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-dark inline-flex items-center gap-1.5 shadow-md shadow-primary/30 disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                type="button" onClick={() => { setForm(snapshot); setError(null); }} disabled={!dirty || saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-ink-700 border border-ink-100 hover:bg-ink-50 inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <RotateCcw className="w-4 h-4" /> Discard
              </button>
              {dirty && <span className="text-xs font-semibold text-warning-text">Unsaved changes</span>}
              {saved && !dirty && <span className="text-xs font-semibold text-success-text">Saved</span>}
            </div>
          )}
          {!canEdit && (
            <p className="text-xs text-ink-500 bg-ink-50 border border-ink-100 rounded-lg px-3 py-2">
              Only a Senior Leader or Finance contact at your company can change these
              details. Ask them, or your EasyFix SPOC.
            </p>
          )}
          {error && (
            <p className="text-sm text-danger-text bg-danger-tint border border-danger/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Your EasyFix people — the comp's "Collected by (EasyFix staff)" slot,
              filled with the fact a client actually wants there. */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink-900">Your EasyFix Team</h3>
            <div className="rounded-xl border border-ink-100 bg-surface px-4 py-3 flex items-start gap-3">
              <UserCircle2 className="w-8 h-8 text-primary shrink-0" />
              <div className="min-w-0">
                {easyfixSpoc ? (
                  <>
                    <div className="text-sm font-semibold text-ink-900">{easyfixSpoc.name || easyfixSpoc.email}</div>
                    <div className="text-xs text-ink-500 break-words">
                      {easyfixSpoc.email}
                      {easyfixSpoc.mobile && <> · {easyfixSpoc.mobile}</>}
                    </div>
                    {support && support.secondary.length > 0 && (
                      <div className="text-xs text-ink-500 mt-1">
                        Backup: {support.secondary.map((s) => s.name || s.email).join(', ')}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-ink-500">
                    No EasyFix SPOC is mapped to your account yet.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Terms — EasyFix's to set */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink-900 inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-ink-500" /> Agreement Terms
            </h3>
            <ManagedByEasyFix what="Everything in this group" />
            <FactGrid>
              <Fact label="Account Type" value={(company.clientType || '').toUpperCase() || null} />
              <Fact label="Reference Code" value={company.referenceCode}
                hint="Also the code behind your public booking link." />
              <Fact
                label="Booking Cut-off"
                value={company.terms.bookingCutOffHours == null
                  ? null
                  : `${company.terms.bookingCutOffHours} hr lead time`}
                hint="How far ahead an appointment must be booked."
              />
              <Fact label="Collected By" value={company.terms.collectedBy?.label ?? null}
                hint="Which party collects payment on a job." />
              <Fact label="Paid By" value={company.terms.paidBy?.label ?? null} />
              <Fact
                label="Travel Radius"
                value={company.terms.travelDistanceKm == null ? null : `${company.terms.travelDistanceKm} km`}
              />
            </FactGrid>
          </div>

          {/* KYC identifiers */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink-900">Registration Numbers</h3>
            <FactGrid>
              <Fact label="CIN" value={company.kyc.cin} />
              <Fact label="PAN" value={company.kyc.pan} />
              <Fact label="MOU Contact" value={company.kyc.mouContact} />
            </FactGrid>
          </div>
        </div>

        {/* ── Right: documents + imagery ─────────────────────────── */}
        <DocumentChecklist />
      </div>
    </SectionShell>
  );
}

/* ── Field primitives ───────────────────────────────────────────────── */

function FieldWrap({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-ink-700 mb-1.5 block">{label}</label>
      {children}
      {hint && <p className="text-xs text-ink-500 mt-1">{hint}</p>}
    </div>
  );
}

const INPUT_CLASS =
  'w-full px-3 py-2.5 text-sm border border-ink-100 rounded-lg bg-surface text-ink-900 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

function EditableField({
  label, hint, value, onChange, canEdit, type = 'text', maxLength, inputMode,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  canEdit: boolean;
  type?: string;
  maxLength?: number;
  inputMode?: 'numeric' | 'text';
}) {
  if (!canEdit) return <ReadOnlyField label={label} value={value} hint={hint} />;
  return (
    <FieldWrap label={label} hint={hint}>
      <input
        type={type}
        value={value}
        inputMode={inputMode}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS}
      />
    </FieldWrap>
  );
}

function EditableTextArea({
  label, value, onChange, canEdit, maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  canEdit: boolean;
  maxLength?: number;
}) {
  if (!canEdit) return <ReadOnlyField label={label} value={value} />;
  return (
    <FieldWrap label={label}>
      <textarea
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className={cn(INPUT_CLASS, 'min-h-[80px] resize-y')}
      />
    </FieldWrap>
  );
}

function ReadOnlyField({
  label, value, hint,
}: {
  label: string;
  value: string | null;
  hint?: string;
}) {
  return (
    <FieldWrap label={label} hint={hint}>
      <div className="w-full px-3 py-2.5 text-sm border border-ink-100 rounded-lg bg-ink-50 text-ink-700 min-h-[42px] break-words">
        {value ? value : <span className="text-ink-300">—</span>}
      </div>
    </FieldWrap>
  );
}
