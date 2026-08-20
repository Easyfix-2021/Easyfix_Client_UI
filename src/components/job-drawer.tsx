'use client';

/*
 * JobDrawer — wide right-side slide-over with a job's full details (real
 * data from GET /jobs/:id). Order: header (Job id · Client Ref Id ·
 * status + last-updated, with PO / Jobsheet / Scroll To), then Customer
 * details → Order Lifecycle → Client details → Checklist (expandable) →
 * Before/After images (expandable) → 4 quick actions. Opened from any
 * job-id click via openJobDrawer(id); one <JobDrawerHost/> in the layout.
 */
import { useEffect, useState } from 'react';
import {
  X, Loader2, Phone, Star, Flame, Activity, User, FileText, Check,
  ClipboardList, ChevronsDown, ImageIcon, IndianRupee, ChevronDown, Briefcase, Info,
} from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { seriesGradient } from '@/brand/charts';
import { STATUS_LABELS } from '@/lib/utils';

type JobFull = {
  job_id: number;
  client_ref_id: string | null;
  job_status: number;
  job_type: string | null;
  source_type: string | null;
  job_desc: string | null;
  remarks: string | null;
  efr_special_notes: string | null;
  collected_by: number | null;
  customer_name: string | null;
  customer_mob_no: string | null;
  address: string | null;
  building: string | null;
  landmark: string | null;
  locality: string | null;
  pin_code: string | null;
  city_name: string | null;
  client_spoc_name: string | null;
  owner_name: string | null;
  created_by_name: string | null;
  easyfixer_name: string | null;
  easyfixer_mobile: string | null;
  ticket_created_date_time: string | null;
  created_date_time: string | null;
  requested_date_time: string | null;
  scheduled_date_time: string | null;
  checkin_date_time: string | null;
  checkout_date_time: string | null;
  services: Array<{ service_catg_name: string | null; service_type_name: string | null }>;
  images: Array<{ image_id: number; image: string; image_category: string | null; job_stage: string | null }>;
};

const OPEN_JOB_EVENT = 'easyfix:open-job';
export function openJobDrawer(jobId: number) {
  window.dispatchEvent(new CustomEvent(OPEN_JOB_EVENT, { detail: jobId }));
}
export function JobDrawerHost() {
  const [jobId, setJobId] = useState<number | null>(null);
  useEffect(() => {
    const h = (e: Event) => { const id = (e as CustomEvent).detail; if (typeof id === 'number') setJobId(id); };
    window.addEventListener(OPEN_JOB_EVENT, h);
    return () => window.removeEventListener(OPEN_JOB_EVENT, h);
  }, []);
  return <JobDrawer jobId={jobId} onClose={() => setJobId(null)} />;
}

function statusPillCls(s: number) {
  switch (s) {
    case 3: case 5:  return 'bg-success-tint text-success-text';
    // On-location was violet; the brand has no violet. `gold` is the one
    // free slot — `info` already carries 0/1 and `warning` carries 9/15 in
    // this same switch, so reusing either would merge two states.
    case 2: case 20: return 'bg-gold-tint text-gold-text';
    case 0: case 1:  return 'bg-info-tint text-info-text';
    case 6:          return 'bg-danger-tint text-danger-text';
    case 9: case 15: return 'bg-warning-tint text-warning-text';
    default:         return 'bg-ink-100 text-ink-700';
  }
}
function fmtDT(d: string | null) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}
function paymentLabel(c: number | null) {
  if (c === 1) return 'Paid by Customer';
  if (c === 2) return 'Free for customer';
  if (c === 3) return 'Paid by Client';
  return null;
}

const SCROLL_ITEMS = [
  { id: 'jd-customer',  label: 'Customer details',      icon: User },
  { id: 'jd-lifecycle', label: 'Order Lifecycle',       icon: Activity },
  { id: 'jd-images',    label: 'Before / After images', icon: ImageIcon },
  { id: 'jd-actions',   label: 'Action buttons',        icon: Star },
];

export function JobDrawer({ jobId, onClose }: { jobId: number | null; onClose: () => void }) {
  const { data: j, loading, error } = useFetch<JobFull>(jobId != null ? `/jobs/${jobId}` : null);
  const [scrollOpen, setScrollOpen] = useState(false);

  useEffect(() => {
    if (jobId == null) return;
    setScrollOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [jobId, onClose]);

  if (jobId == null) return null;

  function goto(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setScrollOpen(false);
  }

  const fullAddress = j ? [j.building, j.address, j.locality, j.landmark, j.city_name, j.pin_code].filter(Boolean).join(', ') : '';
  const svc = j?.services?.[0];
  const serviceChip = j?.job_type || svc?.service_catg_name || svc?.service_type_name || null;
  const pay = j ? paymentLabel(j.collected_by) : null;
  const imgUrl = (id: number) => `/api/client/jobs/${jobId}/images/${id}`;
  const pics = (j?.images || []).filter((im) => !/\.pdf$/i.test(im.image || ''));
  // PO / Jobsheet docs live in tbl_job_image, tagged by image_category.
  const poDoc = (j?.images || []).find((im) => /purchase.?order|^po$/i.test(im.image_category || ''));
  const jsDoc = (j?.images || []).find((im) => /job.?sheet/i.test(im.image_category || ''));

  // "Last updated" = the most recent lifecycle timestamp we have.
  let lastUpdated: string | null = null;
  if (j) {
    let best = -Infinity;
    for (const d of [j.checkout_date_time, j.checkin_date_time, j.scheduled_date_time, j.requested_date_time, j.ticket_created_date_time, j.created_date_time]) {
      if (!d) continue;
      const t = new Date(d).getTime();
      if (!isNaN(t) && t > best) { best = t; lastUpdated = d; }
    }
  }

  const stages = j ? [
    { label: 'Ticket Created', reached: true, date: j.ticket_created_date_time || j.created_date_time },
    { label: 'Cx Appointment', reached: !!j.requested_date_time || j.job_status >= 1, date: j.requested_date_time },
    { label: 'Tx Allocated', reached: !!j.scheduled_date_time || !!j.easyfixer_name || j.job_status >= 1, date: j.scheduled_date_time },
    { label: 'Work Progress', reached: !!j.checkin_date_time || j.job_status === 2 || j.job_status === 20, date: j.checkin_date_time },
    { label: 'Under Audit', reached: !!j.checkout_date_time || j.job_status === 10, date: j.checkout_date_time },
    { label: 'Billing Status', reached: [3, 5, 6].includes(j.job_status), date: [3, 5].includes(j.job_status) ? j.checkout_date_time : null },
  ] : [];
  const n = stages.length;
  let lastConsec = 0;
  for (let i = 0; i < n; i++) { if (stages[i].reached) lastConsec = i; else break; }
  const cx = (i: number) => ((i + 0.5) / n) * 100;

  const hbtn = 'inline-flex items-center gap-1.5 border border-ink-100 bg-surface rounded-lg px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50';

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink-900/45 backdrop-blur-[1px]" />

      <aside className="relative w-full max-w-4xl h-full bg-ink-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="bg-surface border-b border-ink-100 px-5 py-3.5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
                <span className="text-primary">#</span> Job {jobId}
              </h1>
              {j?.client_ref_id && (
                <div className="text-sm font-mono font-semibold text-primary mt-1">Client Ref Id · {j.client_ref_id}</div>
              )}
              {j && (
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${statusPillCls(j.job_status)}`}>
                    {STATUS_LABELS[j.job_status] || `Status ${j.job_status}`}
                  </span>
                  {lastUpdated && <span className="text-xs text-ink-500 italic">Last updated at: {fmtDT(lastUpdated)}</span>}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!poDoc}
                onClick={() => poDoc && window.open(imgUrl(poDoc.image_id), '_blank', 'noopener,noreferrer')}
                title={poDoc ? 'Open Purchase Order' : 'No PO uploaded for this job'}
                className={`${hbtn} ${!poDoc ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <FileText className="w-4 h-4" /> PO
              </button>
              <button
                type="button"
                disabled={!jsDoc}
                onClick={() => jsDoc && window.open(imgUrl(jsDoc.image_id), '_blank', 'noopener,noreferrer')}
                title={jsDoc ? 'Open Job Sheet' : 'No Jobsheet uploaded for this job'}
                className={`${hbtn} ${!jsDoc ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <ClipboardList className="w-4 h-4" /> Jobsheet
              </button>
              <div className="relative">
                <button type="button" onClick={() => setScrollOpen((v) => !v)} className={hbtn}>
                  <ChevronsDown className="w-4 h-4" /> Scroll To
                </button>
                {scrollOpen && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-20 min-w-[210px] bg-surface border border-ink-100 rounded-xl shadow-xl p-1.5">
                    {SCROLL_ITEMS.map((it) => {
                      const Icon = it.icon;
                      return (
                        <button key={it.id} type="button" onClick={() => goto(it.id)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold text-ink-700 hover:bg-ink-100">
                          <Icon className="w-4 h-4 text-ink-300" /> {it.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button type="button" onClick={onClose} className="w-9 h-9 rounded-lg border border-ink-100 grid place-items-center text-ink-500 hover:bg-ink-50" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5" onClick={() => scrollOpen && setScrollOpen(false)}>
          {loading && <div className="text-center py-20 text-ink-300"><Loader2 className="w-6 h-6 mx-auto animate-spin" /><div className="mt-2 text-sm">Loading job…</div></div>}
          {error && !loading && <div className="rounded-lg border border-danger/30 bg-danger-tint px-4 py-3 text-sm text-danger-text">{error}</div>}

          {j && !loading && (
            <div className="space-y-6">
              {/* chips */}
              <div className="flex flex-wrap gap-2.5">
                {serviceChip && <span className="inline-flex px-3 py-1.5 rounded-lg bg-info-tint text-info-text text-sm font-semibold">🏷 {serviceChip}</span>}
                {j.source_type && <span className="inline-flex px-3 py-1.5 rounded-lg bg-ink-100 text-ink-500 text-sm font-semibold">Source · {j.source_type}</span>}
                {pay && <span className="inline-flex px-3 py-1.5 rounded-lg bg-success-tint text-success-text text-sm font-semibold">₹ {pay}</span>}
              </div>

              {/* 1 · Customer details */}
              <section id="jd-customer" className="scroll-mt-4">
                <div className="rounded-2xl ring-1 ring-ink-100 overflow-hidden bg-surface">
                  {/* Decorative header wash — it labels a card, it does not
                      encode a state, so it comes from the categorical ramp
                      rather than from a semantic token. */}
                  <div className="px-5 py-3 text-white font-semibold text-sm tracking-wide"
                    style={{ background: seriesGradient(0, '122deg') }}>
                    CUSTOMER
                  </div>
                  <div className="divide-y divide-ink-100">
                    {([
                      ['Name', j.customer_name || '—'],
                      ['Phone', j.customer_mob_no || '—'],
                      ['Address', fullAddress || '—'],
                      ['Job description', j.job_desc || '—'],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-4 px-5 py-3">
                        <span className="text-sm font-semibold text-ink-500 shrink-0">{label}</span>
                        <span className="text-sm text-ink-900 text-right break-words max-w-[62%]">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* 2 · Order Lifecycle */}
              <section id="jd-lifecycle" className="scroll-mt-4">
                <SecHead icon={Activity} title="Order Lifecycle" tone="gold" />
                <div className="bg-surface rounded-2xl ring-1 ring-ink-100 p-6 overflow-x-auto">
                  <div className="relative min-w-[560px]" style={{ paddingTop: 4 }}>
                    <div className="absolute h-0.5 bg-ink-100" style={{ top: 14, left: `${cx(0)}%`, right: `${100 - cx(n - 1)}%` }} />
                    <div className="absolute h-0.5 bg-primary" style={{ top: 14, left: `${cx(0)}%`, width: `${cx(lastConsec) - cx(0)}%` }} />
                    <div className="relative flex">
                      {stages.map((s) => (
                        <div key={s.label} className="flex flex-col items-center text-center" style={{ flex: 1 }}>
                          <span className={`w-7 h-7 rounded-full grid place-items-center z-10 ${s.reached ? 'bg-primary text-white' : 'bg-surface ring-2 ring-ink-100'}`}>
                            {s.reached ? <Check className="w-3.5 h-3.5" /> : <span className="w-1.5 h-1.5 rounded-full bg-ink-300" />}
                          </span>
                          <span className={`mt-2 text-xs font-semibold ${s.reached ? 'text-ink-900' : 'text-ink-300'}`}>{s.label}</span>
                          {fmtDT(s.date) && <span className="mt-0.5 text-xs text-ink-300">{fmtDT(s.date)}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* Before / After images (expandable) */}
              <Collapsible id="jd-images" icon={ImageIcon} title="Before / After images">
                {pics.length === 0 ? (
                  <div className="text-center text-sm text-ink-300 py-6">No images uploaded yet.</div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {pics.map((im) => (
                      <a key={im.image_id} href={imgUrl(im.image_id)} target="_blank" rel="noopener noreferrer"
                        className="w-28 relative rounded-xl overflow-hidden border border-ink-100 block" title={im.job_stage || im.image_category || 'Image'}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imgUrl(im.image_id)} alt={im.job_stage || 'Job image'} className="w-28 h-28 object-cover" />
                        {(im.job_stage || im.image_category) && (
                          <span className="absolute bottom-0 inset-x-0 bg-ink-900/55 text-white text-xs font-semibold px-1.5 py-0.5 truncate">
                            {im.job_stage || im.image_category}
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </Collapsible>

              {/* 6 · Actions — 4 buttons */}
              <section id="jd-actions" className="scroll-mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
                {/* These four gradients carry MEANING, so each is a semantic
                    token pair rather than a categorical ramp entry:
                    Contact = informational blue, Send Feedback = warning/gold
                    (earned rating), Escalate = danger red, Invoice = success
                    (money settled). */}
                <ActionCard href={j.customer_mob_no ? `tel:${j.customer_mob_no}` : undefined} icon={Phone} title="Contact" sub="Call customer or technician" gradient="linear-gradient(135deg,var(--ef-blue-500),var(--ef-blue-700))" />
                <ActionCard icon={Star} title="Send Feedback" sub="Share what worked or didn't" gradient="linear-gradient(135deg,var(--ef-warning),var(--ef-gold))" />
                <ActionCard icon={Flame} title="Escalate" sub="Flag for urgent ops attention" gradient="linear-gradient(135deg,var(--ef-red-500),var(--ef-red-600))" />
                <ActionCard icon={IndianRupee} title="Invoice" sub="View billing & invoice" gradient="linear-gradient(135deg,var(--ef-success),var(--ef-success-text))" />
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function SecHead({ icon: Icon, title, tone = 'primary' }: {
  icon: React.ComponentType<{ className?: string }>; title: string;
  tone?: 'primary' | 'gold' | 'info' | 'warning' | 'success';
}) {
  /*
   * Each tone is named for the TOKEN FAMILY it resolves to, not for a hue.
   *
   * These were once hue names — `red`, `violet`, `blue`, `amber`, `emerald` —
   * from before the brand sweep. That survived the sweep as a lie: `violet` had
   * no brand equivalent, so it was pointed at gold, and the union then carried a
   * comment explaining that asking for violet got you gold. A prop name that
   * needs a footnote to say what it does is the wrong prop name.
   *
   * Naming them after the families makes the mapping below tautological, which
   * is the point: there is no second vocabulary to keep in sync, and a tone can
   * never again drift from what it renders.
   */
  const t = {
    primary: 'bg-primary-50 text-primary',
    gold:    'bg-gold-tint text-gold-text',
    info:    'bg-info-tint text-info-text',
    warning: 'bg-warning-tint text-warning-text',
    success: 'bg-success-tint text-success-text',
  }[tone];
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={`w-8 h-8 rounded-lg grid place-items-center ${t}`}><Icon className="w-4 h-4" /></span>
      <h2 className="text-base font-semibold text-ink-900">{title}</h2>
    </div>
  );
}

function Collapsible({ id, icon: Icon, title, children }: {
  id: string; icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section id={id} className="scroll-mt-4">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 mb-3 w-full text-left group">
        <span className="w-8 h-8 rounded-lg bg-primary-50 grid place-items-center"><Icon className="w-4 h-4 text-primary" /></span>
        <h2 className="text-base font-semibold text-ink-900 flex-1">{title}</h2>
        <span className="w-7 h-7 rounded-lg border border-ink-100 grid place-items-center text-ink-300 group-hover:bg-ink-50">
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="bg-surface rounded-2xl ring-1 ring-ink-100 p-5">{children}</div>}
    </section>
  );
}

function FieldLabel({ children, info }: { children: React.ReactNode; info?: boolean }) {
  return (
    <label className="flex items-center gap-1.5 text-sm font-semibold text-ink-700 mb-1.5">
      {children} {info && <Info className="w-3.5 h-3.5 text-ink-300" />}
    </label>
  );
}
function FieldBox({ label, value, info, select }: { label: string; value: string; info?: boolean; select?: boolean }) {
  return (
    <div>
      <FieldLabel info={info}>{label}</FieldLabel>
      <div className="flex items-center justify-between gap-2 bg-ink-50 border border-ink-100 rounded-lg px-3 py-2.5 min-h-[42px]">
        <span className="text-sm text-ink-700 truncate" title={value}>{value}</span>
        {select && <ChevronDown className="w-4 h-4 text-ink-300 shrink-0" />}
      </div>
    </div>
  );
}
function Row({ label, children, accent }: { label: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</div>
      <div className={`text-sm mt-0.5 ${accent ? 'font-semibold text-primary' : 'text-ink-900'}`}>{children}</div>
    </div>
  );
}
function ActionCard({ icon: Icon, title, sub, gradient, href }: {
  icon: React.ComponentType<{ className?: string }>; title: string; sub: string; gradient: string; href?: string;
}) {
  const inner = (
    <>
      <span className="w-8 h-8 rounded-lg bg-white/25 grid place-items-center shrink-0"><Icon className="w-4 h-4" /></span>
      <span className="text-left min-w-0">
        <span className="block font-semibold text-sm leading-tight truncate">{title}</span>
        <span className="block text-xs opacity-90 leading-tight truncate">{sub}</span>
      </span>
    </>
  );
  const cls = 'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-white transition hover:brightness-105';
  return href
    ? <a href={href} className={cls} style={{ background: gradient }}>{inner}</a>
    : <button type="button" className={cls} style={{ background: gradient }}>{inner}</button>;
}
