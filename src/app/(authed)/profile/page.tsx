'use client';

/*
 * Client Profile — alternate view of the SPOC profile organised as
 * inline tabs (Identity · Reporting · Workflow Settings) instead of
 * the vertical stacked sections used on /profile.
 *
 * Loads + saves the same backend endpoints as /profile
 *   GET /api/client/profile
 *   PUT /api/client/profile
 * so any edit made here is mirrored on the existing page (and vice
 * versa). The original /profile page is intentionally left untouched
 * — this is an additional surface accessible from the new sidebar
 * entry that's labelled with the client's company name.
 *
 * Layout:
 *   1. Hero card  (identical to /profile — avatar, name, designation,
 *                  verified pills, client logo on the right)
 *   2. Tab bar    (horizontal underline tabs — only the active tab
 *                  shows its body underneath)
 *   3. Tab body   (form fields for the active tab)
 *   4. Save bar   (floats up when dirty, mirrors /profile)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  User, Briefcase, Phone, Mail, Smartphone, Send, Network,
  ShieldCheck, CreditCard, Check, Save, Loader2, Pencil,
  Linkedin, Fingerprint, BadgeCheck, BellRing, FileBadge,
  Sparkles, Wallet, X, Search, ChevronDown,
  Users as UsersIcon, Plus, Upload, Download, AlertCircle,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { api, ApiError, getToken } from '@/lib/api';
import { useFetchOnce } from '@/lib/hooks';
import { cn } from '@/lib/utils';

type Profile = {
  id: number;
  contact_name: string;
  contact_email: string;
  contact_no: string;
  contact_alt_no: string | null;
  contact_desgn: string | null;
  linkedIn_profile: string | null;
  manager_id: number | null;
  email_cc: string | null;
  payment_mode: number | null;
  approval_by_client: number | null;
  client_id?: number | null;
  client_name?: string | null;
  client_logo_url?: string | null;
};

type TeamMember = { id: number; name: string | null; email: string | null };
type TabKey = 'identity' | 'reporting' | 'workflow' | 'contacts';

type Contact = {
  id: number;
  contact_name: string;
  contact_email: string;
  contact_no: string;
  contact_alt_no: string | null;
  contact_desgn: string | null;
  status: number | null;
};

const PAYMENT_MODES: { value: number; label: string }[] = [
  { value: 0, label: '— Not set —' },
  { value: 1, label: 'Cash' },
  { value: 2, label: 'Credit (30 days)' },
  { value: 3, label: 'Credit (60 days)' },
  { value: 4, label: 'Cheque' },
  { value: 5, label: 'Online / UPI' },
  { value: 6, label: 'Bank transfer' },
];

const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'identity',  label: 'Identity',          icon: User },
  { key: 'reporting', label: 'Reporting',         icon: Network },
  { key: 'workflow',  label: 'Workflow Settings', icon: Sparkles },
  { key: 'contacts',  label: 'Contacts',          icon: UsersIcon },
];

function initialsOf(name?: string | null) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ClientProfilePage() {
  const { data, loading, error: fetchError } = useFetchOnce<Profile>('/profile');
  const team = useFetchOnce<{ items: TeamMember[] }>('/team?status=all');

  const [p, setP] = useState<Profile | null>(null);
  const [snapshot, setSnapshot] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [tab, setTab] = useState<TabKey>('identity');
  // OTP-protected change flow for the read-only login identifiers
  // (contact_no, contact_email). null = closed. The modal handles
  // both steps (enter new value → enter OTP) internally so we just
  // need to know which kind is open here.
  const [changeFlow, setChangeFlow] = useState<'phone' | 'email' | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data) { setP(data); setSnapshot(data); }
    if (fetchError) setError(fetchError);
  }, [data, fetchError]);

  // Stable reference — avoids the infinite-loop trap the /profile
  // page also guards against (recreating [] every render would force
  // every downstream useMemo to recompute).
  const managerOptions = useMemo<TeamMember[]>(() => team.data?.items ?? [], [team.data]);
  const currentManager = useMemo(
    () => p?.manager_id ? managerOptions.find((m) => m.id === p.manager_id) ?? null : null,
    [p?.manager_id, managerOptions]
  );

  const isDirty = useMemo(
    () => p && snapshot && JSON.stringify(p) !== JSON.stringify(snapshot),
    [p, snapshot]
  );

  function discard() {
    if (snapshot) setP(snapshot);
    setError(null);
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!p) return;
    // Alt phone — same junk-pattern guard the New Order form uses so
    // placeholder numbers (1111111111, 9999999999, 1234567890,
    // 9090909090, etc.) can't be saved to tbl_client_contacts.contact_alt_no.
    if (p.contact_alt_no) {
      const v = isValidMobile(p.contact_alt_no);
      if (!v.ok) {
        setError(`Alternate phone: ${v.reason}`);
        return;
      }
      if (p.contact_alt_no === p.contact_no) {
        setError('Alternate phone must be different from your primary contact number');
        return;
      }
    }
    // LinkedIn URL — must be an actual linkedin.com profile, not random
    // text. Accepts the four canonical shapes the FE placeholder hints
    // at ("https://linkedin.com/in/your-handle") plus the regional
    // subdomains (in.linkedin.com / uk.linkedin.com / etc.) and the
    // older /pub/ legacy paths.
    if (p.linkedIn_profile && p.linkedIn_profile.trim()) {
      const l = isValidLinkedInUrl(p.linkedIn_profile);
      if (!l.ok) {
        setError(`LinkedIn profile: ${l.reason}`);
        return;
      }
    }
    setSaving(true); setError(null);
    try {
      await api.put('/profile', {
        contact_name: p.contact_name,
        contact_desgn: p.contact_desgn,
        contact_alt_no: p.contact_alt_no,
        linkedIn_profile: p.linkedIn_profile,
        manager_id: p.manager_id,
        email_cc: p.email_cc,
        payment_mode: p.payment_mode,
        approval_by_client: p.approval_by_client,
      });
      setSnapshot(p);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally { setSaving(false); }
  }

  /*
   * Mobile validator — copied from src/app/(authed)/jobs/new/page.tsx so
   * both forms enforce the same junk-pattern rejection rules. Worth
   * extracting to src/lib/validators.ts if we add a third caller.
   *
   * Rejects:
   *   - Wrong format / not 10 digits / wrong prefix
   *   - All same digit       9999999999
   *   - Sequential asc / desc 1234567890 / 9876543210
   *   - Pair-repeat          9090909090
   */
  function isValidMobile(v: string): { ok: true } | { ok: false; reason: string } {
    const m = v.trim();
    if (!/^[6-9]\d{9}$/.test(m)) {
      return { ok: false, reason: 'Enter a valid 10-digit mobile starting 6–9' };
    }
    if (/^(\d)\1{9}$/.test(m)) {
      return { ok: false, reason: 'Cannot be the same digit repeated 10 times' };
    }
    const allAsc = m.split('').every((d, i, a) =>
      i === 0 || (Number(d) - Number(a[i - 1]) + 10) % 10 === 1);
    const allDesc = m.split('').every((d, i, a) =>
      i === 0 || (Number(a[i - 1]) - Number(d) + 10) % 10 === 1);
    if (allAsc || allDesc) {
      return { ok: false, reason: 'Sequential digits aren’t a real mobile number' };
    }
    if (/^(\d)(\d)\1\2\1\2\1\2\1\2$/.test(m)) {
      return { ok: false, reason: 'Looks like a placeholder, not a real number' };
    }
    return { ok: true };
  }

  /*
   * LinkedIn URL validator. Accepts the shapes a SPOC actually pastes:
   *   - https://linkedin.com/in/<handle>
   *   - https://www.linkedin.com/in/<handle>
   *   - https://in.linkedin.com/in/<handle>   (regional subdomain)
   *   - linkedin.com/in/<handle>              (no protocol)
   *   - https://www.linkedin.com/pub/<id>     (legacy public profile)
   *   - https://www.linkedin.com/company/<x>  (company page — kept
   *     permissive in case ops uses the company URL as a placeholder)
   *
   * Rejects:
   *   - Random text ("looking for a job")
   *   - Non-linkedin URLs (https://google.com/foo)
   *   - linkedin.com root with no profile path
   */
  function isValidLinkedInUrl(v: string): { ok: true } | { ok: false; reason: string } {
    const u = v.trim();
    // Must contain linkedin.com (with optional protocol + subdomain)
    // AND have a non-empty path segment after it (the handle).
    const pattern = /^(https?:\/\/)?(www\.|in\.|[a-z]{2}\.)?linkedin\.com\/(in|pub|company|profile)\/[A-Za-z0-9._%-]+\/?(\?.*)?$/i;
    if (!pattern.test(u)) {
      return { ok: false, reason: 'Enter a full LinkedIn profile URL (e.g. https://linkedin.com/in/your-handle)' };
    }
    return { ok: true };
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading profile…
      </div>
    );
  }
  if (!p) {
    return (
      <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        {error || 'Profile not found'}
      </div>
    );
  }

  return (
    <form onSubmit={save} className="max-w-5xl mx-auto pb-28 space-y-6">

      {/* ─── HERO CARD (identical to /profile) ─────────────────── */}
      <div className="relative bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary via-primary-dark to-primary" />
        <div className="p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-start gap-5">
            <div className="shrink-0 mx-auto md:mx-0">
              {/* Profile avatar — pink/violet gradient matching the
                  navbar avatar so the SPOC's identity treatment stays
                  consistent across the dashboard. Same fuchsia → pink
                  → violet ramp, just sized up for the hero card. */}
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-fuchsia-400 via-pink-500 to-violet-600 grid place-items-center text-3xl font-extrabold text-white shadow-md shadow-pink-500/20 ring-4 ring-white">
                {initialsOf(p.contact_name)}
              </div>
            </div>

            <div className="flex-1 min-w-0 text-center md:text-left">
              <h1 className="text-2xl font-bold text-slate-900 leading-tight">
                {p.contact_name || 'Unnamed'}
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                {p.contact_desgn || 'No designation set'}
              </p>
              <div className="flex flex-wrap justify-center md:justify-start gap-2 mt-3">
                <Pill icon={Fingerprint} tone="slate">ID #{p.id}</Pill>
                <Pill icon={ShieldCheck} tone="emerald">Email verified</Pill>
                <Pill icon={ShieldCheck} tone="blue">Mobile verified</Pill>
              </div>
            </div>

            {/* Right-side client brand block (same as /profile) */}
            {(p.client_logo_url || p.client_name) && (
              <div className="shrink-0 mx-auto md:mx-0 flex flex-col items-center gap-1.5">
                <div className="w-24 h-24 rounded-2xl bg-white border border-slate-200 shadow-sm grid place-items-center overflow-hidden p-2">
                  {p.client_logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.client_logo_url}
                      alt={p.client_name || 'Client logo'}
                      className="max-w-full max-h-full object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider text-center px-1">
                      {p.client_name}
                    </span>
                  )}
                </div>
                {p.client_name && (
                  <span className="text-[11px] font-semibold text-slate-500 max-w-[6.5rem] text-center truncate">
                    {p.client_name}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── TAB BAR ──────────────────────────────────────────────
          One horizontal row, brand-red underline on the active tab.
          Each tab shows its icon + label inline. Buttons are
          type=button so they don't trigger the form's onSubmit. */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div role="tablist" aria-label="Profile sections" className="flex items-center gap-1 px-2 border-b border-slate-200 overflow-x-auto">
          {TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={cn(
                  'relative inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold transition whitespace-nowrap',
                  active
                    ? 'text-primary'
                    : 'text-slate-500 hover:text-slate-800'
                )}
              >
                <Icon className="w-4 h-4" />
                {t.label}
                {active && (
                  <span className="absolute left-3 right-3 -bottom-px h-0.5 bg-primary rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab body — single panel per tab */}
        <div className="p-6">
          {tab === 'identity' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  label="Full name" required icon={User}
                  value={p.contact_name || ''}
                  onChange={(v) => setP({ ...p, contact_name: v })}
                />
                <FormField
                  label="Designation" icon={Briefcase}
                  value={p.contact_desgn || ''}
                  onChange={(v) => setP({ ...p, contact_desgn: v })}
                  placeholder="Intern, SPOC, Operations Lead…"
                />
                <ReadOnlyField
                  label="Email address" icon={Mail}
                  value={p.contact_email}
                  onEditClick={() => setChangeFlow('email')}
                />
                <ReadOnlyField
                  label="Contact number" icon={Smartphone}
                  value={p.contact_no}
                  onEditClick={() => setChangeFlow('phone')}
                />
                <FormField
                  label="Alternate phone number" icon={Phone}
                  value={p.contact_alt_no || ''}
                  // Strip non-digits and cap at 10 as the SPOC types so
                  // the field can never hold "12 abc" or 12+ digits.
                  // The junk-pattern check (all-same / sequential /
                  // pair-repeat) still fires on Save — this is just
                  // the on-the-fly typing guard.
                  onChange={(v) => setP({ ...p, contact_alt_no: v.replace(/\D/g, '').slice(0, 10) })}
                  placeholder="10-digit backup number"
                />
                <FormField
                  label="LinkedIn profile" icon={Linkedin}
                  value={p.linkedIn_profile || ''}
                  onChange={(v) => setP({ ...p, linkedIn_profile: v })}
                  placeholder="https://linkedin.com/in/your-handle"
                />
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-900 inline-flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0" />
                Email and mobile are verified. Tap the pencil to change — we'll send an OTP to confirm.
              </div>
            </div>
          )}

          {tab === 'reporting' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ManagerSelect
                value={p.manager_id}
                options={managerOptions.filter((m) => m.id !== p.id)}
                onChange={(id) => setP({ ...p, manager_id: id })}
              />
              <FormField
                label="Notify on each order" icon={Send}
                value={p.email_cc || ''}
                onChange={(v) => setP({ ...p, email_cc: v })}
                placeholder={currentManager?.email || 'cc-email@company.com'}
                hint="Auto-cc'd email on every order raised by you."
              />
            </div>
          )}

          {tab === 'workflow' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ToggleCard
                icon={FileBadge}
                title="Manager approval"
                hint="Each order needs sign-off from your reporting manager before processing."
                checked={p.approval_by_client === 1}
                onChange={(v) => setP({ ...p, approval_by_client: v ? 1 : 0 })}
              />
              <ToggleCard
                icon={BadgeCheck}
                title="Preapproved"
                hint="Skip manager approval — orders flow directly to fulfilment."
                checked={p.approval_by_client === 2}
                onChange={(v) => setP({ ...p, approval_by_client: v ? 2 : 0 })}
              />
              <ToggleCard
                icon={BellRing}
                title="Email RM on every order"
                hint="Auto-cc the reporting manager when an order is raised."
                checked={!!p.email_cc}
                onChange={(v) =>
                  setP({ ...p, email_cc: v ? (currentManager?.email || p.email_cc || '') : '' })
                }
              />
              <PaymentCard
                value={p.payment_mode ?? 0}
                onChange={(v) => setP({ ...p, payment_mode: v })}
              />
            </div>
          )}

          {tab === 'contacts' && <ContactsTab />}
        </div>
      </div>

      {/* Error inline */}
      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Floating SAVE BAR — same shape as /profile */}
      <div
        className={cn(
          'fixed left-0 right-0 bottom-0 z-40 transition-transform duration-300',
          isDirty || saving ? 'translate-y-0' : 'translate-y-full'
        )}
      >
        <div className="max-w-5xl mx-auto px-4 pb-4">
          <div className="bg-white border border-slate-200 shadow-xl rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-sm text-slate-600 inline-flex items-center gap-2 min-w-0">
              {savedFlash ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-emerald-700 font-medium">Saved</span>
                </>
              ) : saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>Saving your changes…</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                  <span className="truncate">You have unsaved changes</span>
                </>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={discard}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <X className="w-4 h-4" /> Discard
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-dark inline-flex items-center gap-1.5 shadow-md shadow-primary/30 disabled:opacity-60"
              >
                <Save className="w-4 h-4" /> Save changes
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* OTP change-flow modal. Rendered conditionally so it doesn't
          live in the DOM when unused. onUpdated optimistically patches
          the displayed identifier so the user sees the new value
          immediately — the next /me fetch on navigation will pull the
          canonical row anyway. */}
      {changeFlow && p && (
        <ChangeIdentifierModal
          kind={changeFlow}
          oldValue={changeFlow === 'phone' ? p.contact_no : p.contact_email}
          onClose={() => setChangeFlow(null)}
          onUpdated={(v) => {
            const patched = changeFlow === 'phone'
              ? { ...p, contact_no: v }
              : { ...p, contact_email: v };
            setP(patched);
            setSnapshot(patched); // keep dirty-state honest — this change is already persisted
            setChangeFlow(null);
            setSuccessMsg(changeFlow === 'phone' ? 'Number updated' : 'Email updated');
          }}
        />
      )}
      {successMsg && (
        <SuccessToastModal message={successMsg} onClose={() => setSuccessMsg(null)} />
      )}
    </form>
  );
}

// ───────────────────────────────────────────────────────────────────
// Subcomponents — kept local on purpose. The /profile page has its
// own copies with the same shape; if these ever drift, refactor both
// into src/components/profile-fields.tsx in a single follow-up.
// ───────────────────────────────────────────────────────────────────

function Pill({
  icon: Icon, children, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  tone: 'slate' | 'emerald' | 'blue';
}) {
  const toneClass =
    tone === 'emerald' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : tone === 'blue'  ? 'bg-blue-50 text-blue-700 ring-blue-200'
    : 'bg-slate-100 text-slate-700 ring-slate-200';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ring-1',
      toneClass
    )}>
      <Icon className="w-3 h-3" />
      {children}
    </span>
  );
}

function FormField({
  label, value, onChange, placeholder, hint, required, icon: Icon, className,
}: {
  label: string; value: string;
  onChange: (v: string) => void;
  placeholder?: string; hint?: string; required?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col', className)}>
      <label className="text-xs font-semibold text-slate-700 mb-1.5 inline-flex items-center gap-1">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg outline-none bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition placeholder:text-slate-300"
        />
      </div>
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

function ReadOnlyField({
  label, value, icon: Icon, onEditClick,
}: {
  label: string; value: string;
  icon: React.ComponentType<{ className?: string }>;
  onEditClick?: () => void;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-700 mb-1.5 inline-flex items-center gap-1">
        {label}
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
      </label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <div className="w-full pl-10 pr-12 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700 font-mono">
          {value || '—'}
        </div>
        {onEditClick && (
          <button
            type="button"
            onClick={onEditClick}
            title={`Change ${label.toLowerCase()}`}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md grid place-items-center text-slate-500 hover:text-primary hover:bg-primary-50 transition"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/*
 * ChangeIdentifierModal — small OTP-protected popup for switching
 * `contact_no` or `contact_email`. Mirrors the legacy SweetAlert flow
 * but with a modern mobile-style layout based on the reference at
 * Downloads/modern_otp_verification_mobile.html.
 *
 * Two steps:
 *   1. enter new value → POST /profile/change-phone|email/send-otp
 *      Backend rejects with 409 if the new value is already taken
 *      across tbl_client_contacts ∪ tbl_user.
 *   2. enter 4-digit OTP → POST .../verify-otp
 *      On success we call onUpdated(newValue) so the parent can
 *      refresh /me and the input field, then close.
 *
 * Resend reissues a fresh OTP (5-min TTL) by re-hitting send-otp with
 * the same target. We keep a 30-second cooldown on the button to
 * stop trigger-happy users from flooding the SMS/email channels.
 */
function ChangeIdentifierModal({
  kind, oldValue, onClose, onUpdated,
}: {
  kind: 'phone' | 'email';
  oldValue: string;
  onClose: () => void;
  onUpdated: (newValue: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [step, setStep] = useState<'enter' | 'otp'>('enter');
  const [newValue, setNewValue] = useState('');
  const [otp, setOtp] = useState(['', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0); // seconds until Resend re-enables
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Resend cooldown timer — re-arms every time send-otp succeeds.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Auto-focus the first OTP cell when we hit step 2 — saves a tap
  // on mobile where the input would otherwise need to be tapped.
  useEffect(() => {
    if (step === 'otp') {
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    }
  }, [step]);

  const isPhone = kind === 'phone';
  const label = isPhone ? 'phone number' : 'email address';
  const Title = isPhone ? 'Change your number' : 'Change your email';
  const targetPath = isPhone ? 'change-phone' : 'change-email';
  const payloadKey = isPhone ? 'new_phone' : 'new_email';

  function setOtpAt(i: number, v: string) {
    // Accept only the first digit if the user paste-spammed multiple
    // chars into one cell, then jump to the next field.
    const d = v.replace(/\D/g, '').slice(0, 1);
    setOtp((prev) => prev.map((c, idx) => (idx === i ? d : c)));
    if (d && i < 3) otpRefs.current[i + 1]?.focus();
  }
  function handleOtpKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    // Backspace on an empty cell jumps to the previous cell so the
    // user can correct a wrong digit with a single Backspace + retype.
    if (e.key === 'Backspace' && !otp[i] && i > 0) {
      otpRefs.current[i - 1]?.focus();
    }
  }
  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    // If the SPOC pastes the OTP from SMS/email, distribute the 4
    // digits across the cells in one shot.
    const txt = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (txt.length === 0) return;
    e.preventDefault();
    const next = ['', '', '', ''];
    for (let i = 0; i < txt.length; i++) next[i] = txt[i];
    setOtp(next);
    otpRefs.current[Math.min(txt.length, 3)]?.focus();
  }

  async function sendOtp(isResend = false) {
    setErr(null); setInfo(null); setBusy(true);
    try {
      const v = isPhone
        ? newValue.replace(/\D/g, '').trim()
        : newValue.trim().toLowerCase();
      if (!v) throw new Error(`Enter a ${label}.`);
      await api.post(`/profile/${targetPath}/send-otp`, { [payloadKey]: v });
      setStep('otp');
      setResendIn(30);
      setInfo(`OTP sent to ${v}.`);
      if (isResend) setOtp(['', '', '', '']);
    } catch (e) {
      // Surface the backend's friendly message verbatim — they're
      // already crafted for end users (e.g. "This number is already
      // registered with another account").
      setErr(e instanceof ApiError ? e.message : 'Could not send OTP. Please try again.');
    } finally { setBusy(false); }
  }

  async function verify() {
    setErr(null); setBusy(true);
    try {
      const code = Number(otp.join(''));
      if (!Number.isInteger(code) || code < 1000 || code > 9999) {
        throw new Error('Enter the 4-digit code.');
      }
      const v = isPhone
        ? newValue.replace(/\D/g, '').trim()
        : newValue.trim().toLowerCase();
      await api.post(`/profile/${targetPath}/verify-otp`, { [payloadKey]: v, otp: code });
      onUpdated(v);
    } catch (e) {
      // Backend returns reason codes (OTP_MISMATCH, OTP_EXPIRED, …) —
      // translate to short, human copy. Anything else falls through
      // to the raw message so we don't swallow useful detail.
      const msg = e instanceof ApiError ? e.message : String(e);
      if (msg === 'OTP_MISMATCH')    setErr('Incorrect code — please re-check.');
      else if (msg === 'OTP_EXPIRED')setErr('Code expired. Tap Resend to get a new one.');
      else if (msg === 'NO_OTP_ISSUED') setErr('No OTP was issued. Tap Resend.');
      else setErr(msg);
    } finally { setBusy(false); }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header — gradient hero with icon. Matches the reference
            design but in our brand palette instead of blue. */}
        <div className="bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-5 pt-5 pb-6 text-center relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 grid place-items-center text-white transition"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="w-14 h-14 mx-auto rounded-2xl bg-white/20 backdrop-blur grid place-items-center shadow-lg">
            {isPhone ? <Smartphone className="w-7 h-7 text-white" /> : <Mail className="w-7 h-7 text-white" />}
          </div>
          <h2 className="mt-3 text-lg font-bold text-white">{Title}</h2>
          <p className="mt-0.5 text-xs text-white/80 whitespace-nowrap">
            {step === 'enter'
              ? `Enter your new ${label}. We'll send a one-time code to verify.`
              : `Enter the 4-digit code we sent to your new ${label}.`}
          </p>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Previous-value reminder. Same input-style box as the
              "New phone number" field below it (matched pair — old
              above, new below) but greyed-out + read-only so the SPOC
              sees it's the *current* value, not editable. */}
          <div>
            <label className="text-xs font-semibold text-slate-700 mb-1.5 block">
              Previous {label}
            </label>
            <div className="w-full px-3 py-2.5 text-sm font-mono font-bold text-slate-700 border border-slate-200 rounded-lg bg-slate-50">
              {oldValue || '—'}
            </div>
          </div>

          {step === 'enter' && (
            <div>
              <label className="text-xs font-semibold text-slate-700 mb-1.5 block">
                New {label}
              </label>
              <input
                type={isPhone ? 'tel' : 'email'}
                inputMode={isPhone ? 'numeric' : 'email'}
                autoFocus
                value={newValue}
                onChange={(e) => {
                  // Phone: digits-only, capped at 10. Email: free text
                  // (we lowercase on submit, not on every keystroke, so
                  // the cursor doesn't jump if they hit Shift mid-type).
                  if (isPhone) setNewValue(e.target.value.replace(/\D/g, '').slice(0, 10));
                  else setNewValue(e.target.value);
                }}
                placeholder={isPhone ? '10-digit mobile number' : 'name@company.com'}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
              />
            </div>
          )}

          {step === 'otp' && (
            <div>
              <label className="text-xs font-semibold text-slate-700 mb-2 block text-center">
                Verification code
              </label>
              <div className="flex items-center justify-center gap-2">
                {otp.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={(e) => setOtpAt(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKey(i, e)}
                    onPaste={handleOtpPaste}
                    className="w-12 h-14 text-center text-xl font-bold border-2 border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                  />
                ))}
              </div>
              <div className="mt-3 text-center text-xs">
                {resendIn > 0 ? (
                  <span className="text-slate-500">Resend code in {resendIn}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => sendOtp(true)}
                    disabled={busy}
                    className="text-indigo-600 hover:text-indigo-800 font-semibold disabled:opacity-60"
                  >
                    Resend code
                  </button>
                )}
              </div>
            </div>
          )}

          {info && step === 'otp' && (
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-xs text-indigo-900">
              {info}
            </div>
          )}
          {err && (
            <div className="rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-900 inline-flex items-start gap-2 w-full">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-600" />
              <span>{err}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            {step === 'enter' ? (
              <button
                type="button"
                onClick={() => sendOtp(false)}
                disabled={busy || !newValue}
                className="flex-1 px-3 py-2.5 text-sm font-semibold rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow hover:shadow-md disabled:opacity-60 transition inline-flex items-center justify-center gap-1.5"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send code
              </button>
            ) : (
              <button
                type="button"
                onClick={verify}
                disabled={busy || otp.some((c) => !c)}
                className="flex-1 px-3 py-2.5 text-sm font-semibold rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow hover:shadow-md disabled:opacity-60 transition inline-flex items-center justify-center gap-1.5"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Update
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/*
 * SuccessToastModal — tiny celebratory popup we render after a
 * successful number / email change. The user explicitly asked for a
 * "popup [saying] number is updated" so we keep it as a deliberate
 * dialog (not a corner toast) — clearer feedback that the OTP flow
 * completed successfully.
 */
function SuccessToastModal({
  message, onClose,
}: {
  message: string; onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // Auto-dismiss after 1.8 seconds — long enough to read, short
  // enough that the SPOC doesn't need to hunt for a close button.
  useEffect(() => {
    const t = setTimeout(onClose, 1800);
    return () => clearTimeout(t);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl px-6 py-5 max-w-xs text-center animate-in fade-in zoom-in-95">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 grid place-items-center">
          <Check className="w-6 h-6 text-emerald-600" />
        </div>
        <div className="mt-3 text-sm font-semibold text-slate-800">{message}</div>
      </div>
    </div>,
    document.body
  );
}

// ManagerSelect — search-as-you-type combobox. Shape mirrors the
// /profile page's component so behaviour is identical.
function ManagerSelect({
  value, options, onChange,
}: {
  value: number | null;
  options: TeamMember[];
  onChange: (id: number | null) => void;
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
    () => options.find((m) => m.id === value) ?? null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((m) =>
      (m.name || '').toLowerCase().includes(needle) ||
      (m.email || '').toLowerCase().includes(needle)
    );
  }, [options, query]);

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

  const buttonLabel = selected
    ? (selected.email ? `${selected.name} · ${selected.email}` : selected.name || `User #${selected.id}`)
    : '— Pick a manager —';

  return (
    <div ref={rootRef} className="relative">
      <label className="text-xs font-semibold text-slate-700 mb-1.5 inline-flex items-center gap-1">
        Reporting manager
        <span className="text-rose-500">*</span>
      </label>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center justify-between gap-2 pl-10 pr-2 py-2.5 text-sm border rounded-lg bg-white relative transition outline-none',
          open
            ? 'border-primary ring-2 ring-primary/20'
            : 'border-slate-200 hover:border-slate-300',
          selected ? 'text-slate-800' : 'text-slate-400'
        )}
      >
        <Network className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
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
        <div className="absolute z-30 mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-80 overflow-hidden flex flex-col">
          <div className="relative border-b border-slate-100 p-2">
            <Search className="w-3.5 h-3.5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder="Type to search by name or email…"
              className="w-full pl-8 pr-2 py-1.5 text-sm border border-slate-200 rounded outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
            />
          </div>
          <ul ref={listRef} className="flex-1 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-xs text-slate-400 text-center">
                No matches{query ? ` for "${query}"` : ''}.
              </li>
            )}
            {filtered.map((m, i) => {
              const isSelected = m.id === value;
              const isActive = i === active;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => selectId(m.id)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left',
                      isActive ? 'bg-primary/10' : '',
                      isSelected ? 'text-primary font-semibold' : 'text-slate-700'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{m.name || `User #${m.id}`}</span>
                      {m.email && (
                        <span className="block text-xs text-slate-500 truncate">{m.email}</span>
                      )}
                    </span>
                    {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function ToggleCard({
  icon: Icon, title, hint, checked, onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string; hint: string;
  checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition',
        checked
          ? 'border-primary bg-primary-50/40 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300'
      )}
    >
      <div className={cn(
        'w-9 h-9 rounded-lg grid place-items-center shrink-0 transition',
        checked ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'
      )}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          <span className={cn(
            'relative inline-flex shrink-0 w-9 h-5 rounded-full transition',
            checked ? 'bg-primary' : 'bg-slate-300'
          )}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
              className="sr-only"
            />
            <span className={cn(
              'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
              checked ? 'translate-x-[18px]' : 'translate-x-0.5'
            )} />
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{hint}</p>
      </div>
    </label>
  );
}

/*
 * ContactsTab — Profile → Contacts tab body.
 *
 * Renders the client's contact directory (tbl_client_contacts scoped
 * to the SPOC's client) as an editable table. Mirrors the legacy
 * admin Clients → Contacts tab from CRM_UI: add, edit, delete,
 * download XLSX template, bulk upload XLSX.
 *
 * State strategy:
 *   - list           — fetched once on mount; mutations refetch
 *   - editing        — { id, draft } when editing an existing row
 *   - showAdd        — modal flag for the create form
 *   - showBulk       — flag for the bulk upload dialog
 *   - busy           — disables buttons during in-flight save / delete
 *   - bulkReport     — last bulk-upload summary, shown inline
 *
 * Endpoints (added in routes/client/index.js):
 *   GET    /api/client/contacts
 *   POST   /api/client/contacts                { contactName, contactEmail, contactNo, ... }
 *   PUT    /api/client/contacts/:id            { contact_name, contact_no, ... }
 *   DELETE /api/client/contacts/:id
 *   GET    /api/client/contacts/template       (xlsx download)
 *   POST   /api/client/contacts/bulk-upload    (multipart)
 */
function ContactsTab() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ─── Pagination ────────────────────────────────────────────────
  // Client-side slicing of the full contacts list. The backend's
  // /contacts endpoint already returns the entire roster (typically
  // tens, not hundreds of rows), so paginating in-memory avoids an
  // extra round-trip and keeps the toggle/edit flows simple — they
  // mutate `contacts` directly and the slice re-derives.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(contacts.length / pageSize));
  // Re-clamp the current page whenever the dataset shrinks below it
  // (e.g. last row deleted, page-size bumped). Prevents the table
  // from showing an empty page after a contact is removed.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const offset = (page - 1) * pageSize;
  const visibleContacts = contacts.slice(offset, offset + pageSize);
  const firstIdx = contacts.length === 0 ? 0 : offset + 1;
  const lastIdx  = Math.min(offset + pageSize, contacts.length);

  // Editor state — either editing an existing contact (id set) or
  // adding a brand-new one (id === null).
  type Draft = {
    contactName: string;
    contactEmail: string;
    contactNo: string;
    contactAltNo: string;
    contactDesgn: string;
  };
  const EMPTY_DRAFT: Draft = {
    contactName: '', contactEmail: '', contactNo: '',
    contactAltNo: '', contactDesgn: '',
  };
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editorError, setEditorError] = useState<string | null>(null);

  // Bulk upload state
  const [showBulk, setShowBulk] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkReport, setBulkReport] = useState<{
    summary: { total: number; created: number; skipped: number; invalid: number };
    results: Array<{ rowNumber: number; status: string; errors?: string[]; reason?: string }>;
  } | null>(null);

  async function loadContacts() {
    setLoading(true); setError(null);
    try {
      const res = await api.get<{ items: Contact[] }>('/contacts');
      setContacts(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadContacts(); }, []);

  function openAdd() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setEditorError(null);
    setEditorOpen(true);
  }
  function openEdit(c: Contact) {
    setEditingId(c.id);
    setDraft({
      contactName:  c.contact_name || '',
      contactEmail: c.contact_email || '',
      contactNo:    c.contact_no || '',
      contactAltNo: c.contact_alt_no || '',
      contactDesgn: c.contact_desgn || '',
    });
    setEditorError(null);
    setEditorOpen(true);
  }

  async function saveDraft() {
    setEditorError(null);
    if (!draft.contactName.trim()) { setEditorError('Name is required'); return; }
    if (!draft.contactDesgn.trim()) { setEditorError('Designation is required'); return; }
    if (!/.+@.+\..+/.test(draft.contactEmail)) { setEditorError('Valid email is required'); return; }
    if (!/^[0-9]{10}$/.test(draft.contactNo)) { setEditorError('Phone must be 10 digits'); return; }
    if (draft.contactAltNo && !/^[0-9]{10}$/.test(draft.contactAltNo)) {
      setEditorError('Alt phone must be 10 digits'); return;
    }
    setBusy(true);
    try {
      const payload = {
        contactName:  draft.contactName.trim(),
        contactEmail: draft.contactEmail.trim().toLowerCase(),
        contactNo:    draft.contactNo.trim(),
        contactAltNo: draft.contactAltNo.trim() || undefined,
        contactDesgn: draft.contactDesgn.trim() || undefined,
      };
      if (editingId == null) {
        await api.post('/contacts', payload);
      } else {
        await api.put(`/contacts/${editingId}`, payload);
      }
      setEditorOpen(false);
      await loadContacts();
    } catch (err) {
      setEditorError(err instanceof ApiError ? err.message : 'Save failed');
    } finally { setBusy(false); }
  }

  /*
   * Soft-toggle a contact's active flag. tbl_client_contacts.status
   * convention (matches admin):
   *   1 = Active
   *   0 = Inactive
   * Inactive contacts can't log in / receive notifications but their
   * historical job rows still reference them, so we never hard-delete
   * — the operator chooses Active/Inactive instead of "remove".
   *
   * Number() coercion guards against the mysql2 driver returning
   * TINYINT as a string on certain configs — `'1' === 1` is false
   * in JS, which would make the toggle send the wrong target value.
   */
  async function toggleStatus(c: Contact) {
    const currentlyActive = Number(c.status) === 1;
    const next = currentlyActive ? 0 : 1;
    const verb = next === 1 ? 'Activate' : 'Deactivate';
    if (!confirm(`${verb} ${c.contact_name || 'this contact'}?`)) return;
    setBusy(true); setError(null);
    try {
      const res = await api.put<{ updated?: boolean; affected?: number }>(
        `/contacts/${c.id}`,
        { status: next }
      );
      // Detect silent no-ops — if the BE says affected=0 something's
      // off (column missing, route caching, etc.). Surface it.
      if (res && 'affected' in res && res.affected === 0) {
        setError('No rows changed — please refresh and try again.');
      }
      await loadContacts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${verb} failed`);
    } finally { setBusy(false); }
  }

  // Template download — we hit the endpoint with a Bearer token via
  // fetch (instead of <a>) so the JWT travels in the Authorization
  // header. Same pattern as downloadBlob in src/lib/api.ts.
  async function downloadTemplate() {
    try {
      const token = getToken();
      const res = await fetch('/api/client/contacts/template', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'contacts-template.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  }

  async function submitBulk() {
    if (!bulkFile) { setError('Pick a file first'); return; }
    setBusy(true); setError(null); setBulkReport(null);
    try {
      const token = getToken();
      const form = new FormData();
      form.append('file', bulkFile);
      const res = await fetch('/api/client/contacts/bulk-upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const json = await res.json();
      if (!res.ok || json.isError) {
        throw new Error(json.message || 'Upload failed');
      }
      setBulkReport(json.data);
      await loadContacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {/* Header — count + action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{contacts.length}</span>{' '}
          contact{contacts.length === 1 ? '' : 's'} in your directory
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 transition"
          >
            <Download className="w-3.5 h-3.5" /> Template
          </button>
          <button
            type="button"
            onClick={() => { setShowBulk(true); setBulkFile(null); setBulkReport(null); }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 transition"
          >
            <Upload className="w-3.5 h-3.5" /> Bulk Upload
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold text-white bg-primary hover:bg-primary-dark shadow-sm shadow-primary/30 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Add Contact
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 inline-flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Name</th>
              <th className="text-left px-4 py-2 font-semibold">Phone</th>
              <th className="text-left px-4 py-2 font-semibold">Email</th>
              <th className="text-left px-4 py-2 font-semibold">Designation</th>
              <th className="text-right px-4 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" /> Loading contacts…
              </td></tr>
            )}
            {!loading && contacts.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                No contacts yet. Click <span className="font-semibold">Add Contact</span> to start the directory.
              </td></tr>
            )}
            {!loading && visibleContacts.map((c) => {
              // Number() guards against mysql2 returning TINYINT as
              // a string in some setups (see toggleStatus comment).
              const isActive = Number(c.status) === 1;
              return (
              <tr key={c.id} className={cn(
                'transition',
                isActive ? 'hover:bg-slate-50/60' : 'bg-slate-50/50 text-slate-400 hover:bg-slate-100/60'
              )}>
                <td className="px-4 py-2.5 font-medium">
                  <span className={isActive ? 'text-slate-900' : 'text-slate-500'}>
                    {c.contact_name || '—'}
                  </span>
                  {!isActive && (
                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-600 uppercase tracking-wider">
                      Inactive
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono">{c.contact_no || '—'}</td>
                <td className="px-4 py-2.5">{c.contact_email || '—'}</td>
                <td className="px-4 py-2.5">{c.contact_desgn || '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="inline-flex items-center gap-2">
                    {/* Active/Inactive toggle — replaces the old delete
                        button. tbl_client_contacts.status:
                          1 = Active   (green pill, switch ON)
                          0 = Inactive (slate pill, switch OFF)
                        Soft-toggle so historical job rows that reference
                        this contact keep working. */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isActive}
                      onClick={() => toggleStatus(c)}
                      disabled={busy}
                      title={isActive ? 'Deactivate contact' : 'Activate contact'}
                      className={cn(
                        'relative inline-flex items-center w-10 h-5 rounded-full transition disabled:opacity-50',
                        isActive ? 'bg-emerald-500' : 'bg-slate-300'
                      )}
                    >
                      <span className={cn(
                        'inline-block w-4 h-4 bg-white rounded-full shadow transition-transform',
                        isActive ? 'translate-x-[22px]' : 'translate-x-0.5'
                      )} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      disabled={busy}
                      title="Edit contact"
                      className="p-1.5 rounded-md text-slate-500 hover:text-primary hover:bg-primary/10 transition disabled:opacity-50"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination footer — first/prev/page-input/next/last + the
          "showing X–Y of Z" range. Same control set as the Dashboard
          and My Technicians pages so the SPOC's mental model stays
          consistent across the app. Hidden when fewer than pageSize
          contacts exist (nothing to paginate). */}
      {!loading && contacts.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 pt-3 border-t border-slate-100">
          <span>
            Showing <span className="font-semibold">{firstIdx}</span>–
            <span className="font-semibold">{lastIdx}</span> of{' '}
            <span className="font-semibold">{contacts.length.toLocaleString('en-IN')}</span>
          </span>
          <div className="flex items-center gap-1">
            <select
              className="input max-w-[120px] mr-2"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              aria-label="Rows per page"
            >
              {[5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>{n} per page</option>
              ))}
            </select>
            {/* First-page jump — useful when the SPOC has paged into a
                long contact roster and wants to start over. */}
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={page <= 1}
              className="btn-outline disabled:cursor-not-allowed"
              aria-label="First page"
              title="First page"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-outline disabled:cursor-not-allowed"
              aria-label="Previous page"
              title="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {/* Direct page-number input. Live editing is clamped only
                on commit (blur / change) so the SPOC can type "12"
                without it snapping to "1" mid-keystroke. */}
            <span className="px-2 py-1.5 inline-flex items-center gap-1.5">
              Page
              <input
                type="number"
                min={1}
                max={pageCount}
                value={page}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isInteger(v) && v >= 1 && v <= pageCount) setPage(v);
                }}
                onBlur={(e) => {
                  const v = Math.max(1, Math.min(pageCount, Number(e.target.value) || 1));
                  setPage(v);
                }}
                className="w-14 px-2 py-1 text-center border border-slate-300 rounded text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                aria-label="Go to page"
              />
              of <span className="font-semibold">{pageCount}</span>
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
              className="btn-outline disabled:cursor-not-allowed"
              aria-label="Next page"
              title="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setPage(pageCount)}
              disabled={page >= pageCount}
              className="btn-outline disabled:cursor-not-allowed"
              aria-label="Last page"
              title="Last page"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Editor modal — portaled to document.body so the backdrop
          always covers the full viewport (the parent `<main>` has its
          own scroll container, which was clipping a non-portaled
          fixed-inset-0 overlay). */}
      {editorOpen && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/30 backdrop-blur-sm px-4"
          onClick={() => !busy && setEditorOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">
                {editingId == null ? 'Add Contact' : 'Edit Contact'}
              </h2>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                disabled={busy}
                className="w-8 h-8 rounded-full grid place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                label="Full name" required icon={User}
                value={draft.contactName}
                onChange={(v) => setDraft({ ...draft, contactName: v })}
              />
              <FormField
                label="Designation" required icon={Briefcase}
                value={draft.contactDesgn}
                onChange={(v) => setDraft({ ...draft, contactDesgn: v })}
                placeholder="Manager, SPOC, …"
              />
              <FormField
                label="Email" required icon={Mail}
                value={draft.contactEmail}
                onChange={(v) => setDraft({ ...draft, contactEmail: v })}
                placeholder="name@company.com"
              />
              <FormField
                label="Phone" required icon={Smartphone}
                value={draft.contactNo}
                onChange={(v) => setDraft({ ...draft, contactNo: v.replace(/\D/g, '').slice(0, 10) })}
                placeholder="10 digits"
              />
              <FormField
                className="sm:col-span-2"
                label="Alternate phone" icon={Phone}
                value={draft.contactAltNo}
                onChange={(v) => setDraft({ ...draft, contactAltNo: v.replace(/\D/g, '').slice(0, 10) })}
                placeholder="optional"
              />
              {editorError && (
                <div className="sm:col-span-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 inline-flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> {editorError}
                </div>
              )}
              <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  disabled={busy}
                  className="px-4 py-2 rounded-md text-sm font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={busy}
                  className="px-5 py-2 rounded-md text-sm font-semibold text-white bg-primary hover:bg-primary-dark inline-flex items-center gap-1.5 shadow-sm shadow-primary/30 disabled:opacity-60"
                >
                  {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <>{editingId == null ? 'Add Contact' : 'Save Changes'}</>}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Bulk upload modal — same portal trick as the editor */}
      {showBulk && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/30 backdrop-blur-sm px-4"
          onClick={() => !busy && setShowBulk(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 inline-flex items-center gap-2">
                <Upload className="w-5 h-5 text-primary" /> Bulk Upload Contacts
              </h2>
              <button
                type="button"
                onClick={() => setShowBulk(false)}
                disabled={busy}
                className="w-8 h-8 rounded-full grid place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                Upload an <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">.xlsx</code> file with one row per contact.
                Don&apos;t have one? <button type="button" onClick={downloadTemplate} className="text-primary font-semibold hover:underline">Download the template</button>.
              </p>
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => setBulkFile(e.target.files?.[0] ?? null)}
                disabled={busy}
                className="block w-full text-sm text-slate-700 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary hover:file:bg-primary-100"
              />
              {bulkReport && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-sm">
                  <div className="font-semibold text-slate-800">Result:</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="text-slate-600">Total: <span className="font-semibold text-slate-900">{bulkReport.summary.total}</span></div>
                    <div className="text-emerald-700">Created: <span className="font-semibold">{bulkReport.summary.created}</span></div>
                    <div className="text-amber-700">Skipped: <span className="font-semibold">{bulkReport.summary.skipped}</span></div>
                    <div className="text-rose-700">Invalid: <span className="font-semibold">{bulkReport.summary.invalid}</span></div>
                  </div>
                  {bulkReport.results.some((r) => r.status !== 'created') && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-slate-600 hover:text-slate-900">Show errors</summary>
                      <ul className="mt-2 max-h-40 overflow-auto space-y-1">
                        {bulkReport.results
                          .filter((r) => r.status !== 'created')
                          .map((r, i) => (
                            <li key={i} className="text-slate-700">
                              Row {r.rowNumber}: <span className="font-mono text-rose-700">{r.errors?.join(', ') || r.reason || r.status}</span>
                            </li>
                          ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowBulk(false)}
                  disabled={busy}
                  className="px-4 py-2 rounded-md text-sm font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={submitBulk}
                  disabled={busy || !bulkFile}
                  className="px-5 py-2 rounded-md text-sm font-semibold text-white bg-primary hover:bg-primary-dark inline-flex items-center gap-1.5 shadow-sm shadow-primary/30 disabled:opacity-60"
                >
                  {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</> : 'Upload'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function PaymentCard({
  value, onChange,
}: {
  value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 grid place-items-center">
          <Wallet className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <span className="text-sm font-semibold text-slate-900">Payment mode</span>
          <p className="text-xs text-slate-500">How you settle invoices.</p>
        </div>
      </div>
      <div className="relative mt-2">
        <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <select
          value={String(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full pl-10 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition appearance-none cursor-pointer"
        >
          {PAYMENT_MODES.map((m) => (
            <option key={m.value} value={String(m.value)}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
