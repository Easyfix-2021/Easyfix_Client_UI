'use client';

/*
 * My Profile — single-column light layout (2026-05-29 v3).
 *
 * Sidebar removed (dark slate felt out-of-brand for enterprise clients).
 * Replaced with a top "hero card" carrying avatar + name + designation +
 * verified pills + quick-stats strip. Sections stack vertically beneath
 * with subtle dividers; brand red is the primary accent throughout.
 *
 * Other patterns kept from v2:
 *  - Floating save bar that only appears when dirty
 *  - Toggle CARDS (not rows) with icon tiles
 *  - Designation = plain text input (no dropdown)
 *  - Read-only verified fields with a "request edit" pencil
 *
 * Backend contract unchanged: GET / PUT /api/client/profile.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  User, Briefcase, Phone, Mail, Smartphone, Send, Network,
  ShieldCheck, CreditCard, Camera, Check, Save,
  Loader2, Pencil, Linkedin, Fingerprint,
  BadgeCheck, BellRing, FileBadge, AtSign,
  Sparkles, Wallet, X, Search, ChevronDown,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
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
};

type TeamMember = { id: number; name: string | null; email: string | null };

const PAYMENT_MODES: { value: number; label: string }[] = [
  { value: 0, label: '— Not set —' },
  { value: 1, label: 'Cash' },
  { value: 2, label: 'Credit (30 days)' },
  { value: 3, label: 'Credit (60 days)' },
  { value: 4, label: 'Cheque' },
  { value: 5, label: 'Online / UPI' },
  { value: 6, label: 'Bank transfer' },
];

function initialsOf(name?: string | null) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ProfilePage() {
  const { data, loading, error: fetchError } = useFetchOnce<Profile>('/profile');
  const team = useFetchOnce<{ items: TeamMember[] }>('/team?status=all');

  const [p, setP] = useState<Profile | null>(null);
  const [snapshot, setSnapshot] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (data) { setP(data); setSnapshot(data); }
    if (fetchError) setError(fetchError);
  }, [data, fetchError]);

  // useMemo so the reference is stable across renders — without it,
  // every render creates a new [] and the downstream `useMemo`
  // recomputes for nothing (and risks an infinite loop in any future
  // useEffect that depends on it).
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
    <form onSubmit={save} className="max-w-4xl mx-auto pb-28 space-y-6">

      {/* ─── HERO CARD ────────────────────────────────────────────
          Single light card with a thin red accent strip on the left.
          Holds avatar, name, designation, verified pills, plus a
          horizontal quick-stats strip. Enterprise-friendly: zero
          gradients, soft shadows, white background, brand-red accents
          only where they earn attention. */}
      <div className="relative bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Thin red side stripe — subtle brand presence */}
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary via-primary-dark to-primary" />
        <div className="p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-start gap-5">
            {/* Avatar with subtle ring + camera */}
            <div className="relative shrink-0 mx-auto md:mx-0">
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary to-primary-dark grid place-items-center text-3xl font-extrabold text-white shadow-md shadow-primary/20 ring-4 ring-white">
                {initialsOf(p.contact_name)}
              </div>
              <button
                type="button"
                title="Change photo (coming soon)"
                className="absolute -bottom-1 -right-1 w-8 h-8 bg-white text-primary rounded-full grid place-items-center shadow ring-1 ring-slate-200 hover:scale-105 transition"
                aria-label="Change photo"
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>

            {/* Identity block */}
            <div className="flex-1 min-w-0 text-center md:text-left">
              <h1 className="text-2xl font-bold text-slate-900 leading-tight">
                {p.contact_name || 'Unnamed'}
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                {p.contact_desgn || 'No designation set'}
              </p>
              {/* Verified pills */}
              <div className="flex flex-wrap justify-center md:justify-start gap-2 mt-3">
                <Pill icon={Fingerprint} tone="slate">
                  ID #{p.id}
                </Pill>
                <Pill icon={ShieldCheck} tone="emerald">
                  Email verified
                </Pill>
                <Pill icon={ShieldCheck} tone="blue">
                  Mobile verified
                </Pill>
              </div>
            </div>
          </div>

          {/* Quick stats strip — divider line above */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-slate-200 rounded-xl overflow-hidden mt-7 border border-slate-200">
            <QuickStat label="Email" value={p.contact_email} icon={Mail} />
            <QuickStat label="Mobile" value={p.contact_no} icon={Smartphone} />
            <QuickStat
              label="Reports to"
              value={currentManager?.name || '—'}
              icon={Network}
            />
          </div>
        </div>
      </div>

      {/* ─── IDENTITY ───────────────────────────────────────────── */}
      <Section
        title="Identity"
        hint="How you appear across orders, invoices and your team."
        icon={User}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            label="Full name" required icon={User}
            value={p.contact_name || ''}
            onChange={(v) => setP({ ...p, contact_name: v })}
          />
          <FormField
            label="Designation" required icon={Briefcase}
            value={p.contact_desgn || ''}
            onChange={(v) => setP({ ...p, contact_desgn: v })}
            placeholder="Intern, SPOC, Operations Lead…"
          />
          <FormField
            className="sm:col-span-2"
            label="LinkedIn profile" icon={Linkedin}
            value={p.linkedIn_profile || ''}
            onChange={(v) => setP({ ...p, linkedIn_profile: v })}
            placeholder="https://linkedin.com/in/your-handle"
          />
        </div>
      </Section>

      {/* ─── COMMUNICATION ──────────────────────────────────────── */}
      <Section
        title="Communication"
        hint="Verified contacts that EasyFix uses to reach you."
        icon={AtSign}
      >
        <div className="space-y-3">
          <ReadOnlyField
            label="Email address" icon={Mail}
            value={p.contact_email}
          />
          <ReadOnlyField
            label="Contact number" icon={Smartphone}
            value={p.contact_no}
          />
          <FormField
            label="Alternate mobile" icon={Phone}
            value={p.contact_alt_no || ''}
            onChange={(v) => setP({ ...p, contact_alt_no: v })}
            placeholder="10-digit backup number"
          />
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-900 inline-flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0" />
            Email and mobile are verified. Contact ops to request a change.
          </div>
        </div>
      </Section>

      {/* ─── REPORTING ──────────────────────────────────────────── */}
      <Section
        title="Reporting"
        hint="Who approves your orders and gets notified."
        icon={Network}
      >
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
      </Section>

      {/* ─── WORKFLOW SETTINGS ──────────────────────────────────── */}
      <Section
        title="Workflow settings"
        hint="Approval flow and payment defaults for your orders."
        icon={Sparkles}
      >
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
      </Section>

      {/* Error inline */}
      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Floating SAVE BAR — slides up only when dirty. */}
      <div
        className={cn(
          'fixed left-0 right-0 bottom-0 z-40 transition-transform duration-300',
          isDirty || saving ? 'translate-y-0' : 'translate-y-full'
        )}
      >
        <div className="max-w-4xl mx-auto px-4 pb-4">
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
    </form>
  );
}

// ───────────────────────────────────────────────────────────────────
// Subcomponents
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

function QuickStat({
  label, value, icon: Icon,
}: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 inline-flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="text-sm text-slate-800 truncate font-medium">
        {value || '—'}
      </div>
    </div>
  );
}

function Section({
  title, hint, icon: Icon, children,
}: {
  title: string; hint: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 grid place-items-center shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        {children}
      </div>
    </div>
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
  label, value, icon: Icon,
}: {
  label: string; value: string;
  icon: React.ComponentType<{ className?: string }>;
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
        <button
          type="button"
          title="Request edit (contact ops)"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md grid place-items-center text-slate-400 hover:text-primary hover:bg-primary-50 transition"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/*
 * ManagerSelect — type-ahead combobox.
 *
 * Replaces the native <select> so users can search the team list by
 * typing instead of scrolling through every option. Filter matches
 * against name + email; arrow keys move the highlight, Enter selects.
 *
 * Keyboard:
 *   ↓ / ↑   — move highlighted row
 *   Enter   — select highlighted row
 *   Esc     — close popover (or clear search if open + has text)
 *   Click outside — close popover
 *
 * State:
 *   open    — popover visibility
 *   query   — current search text
 *   active  — keyboard-highlighted index within filtered list
 */
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

  // Outside-click closes the popover. Listener attached only while open.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Reset query + highlight when popover toggles open.
  useEffect(() => {
    if (open) { setQuery(''); setActive(0); }
  }, [open]);

  const selected = useMemo(
    () => options.find((m) => m.id === value) ?? null,
    [options, value]
  );

  // Case-insensitive filter across name + email. Empty query shows all.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((m) =>
      (m.name || '').toLowerCase().includes(needle) ||
      (m.email || '').toLowerCase().includes(needle)
    );
  }, [options, query]);

  // Keep the highlighted row in view as the user arrows up/down.
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

  // Button label — when nothing selected we show the placeholder pill.
  const buttonLabel = selected
    ? (selected.email ? `${selected.name} · ${selected.email}` : selected.name || `User #${selected.id}`)
    : '— Pick a manager —';

  return (
    <div ref={rootRef} className="relative">
      <label className="text-xs font-semibold text-slate-700 mb-1.5 inline-flex items-center gap-1">
        Reporting manager
        <span className="text-rose-500">*</span>
      </label>

      {/* Trigger button — looks like the existing input style for visual
          parity with other form fields on this page. */}
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

      {/* Popover — search input + filtered options. Positioned right
          below the trigger; max-height keeps long team lists scrollable. */}
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
              className="w-full pl-8 pr-2 py-1.5 text-sm border border-slate-200 rounded outline-none focus:border-primary"
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
          {/* Footer hint — only useful when there are many options */}
          {filtered.length > 5 && (
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
