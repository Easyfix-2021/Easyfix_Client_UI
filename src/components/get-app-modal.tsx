'use client';

/*
 * GetAppModal — "Take EasyFix with you" mobile-app promo.
 *
 * Shown automatically once after login (the (authed) layout gates this
 * on a `localStorage` flag so it never nags), and re-openable any time
 * from the "Get the App" button in the top bar.
 *
 * Contents: Android / iPhone tabs, store badges, an illustrative QR
 * (placeholder — swap for a real encoded QR once store URLs are final),
 * and a copy-link field. Links are DUMMY placeholders for now; replace
 * the constants below with the real store URLs when the apps ship.
 */
import { useEffect, useRef, useState } from 'react';
import { X, Copy, Check, Smartphone } from 'lucide-react';

// ─── Dummy links — replace with the real ones when the apps are live ───
const APP_LINK = 'https://easyfix.in/app';
const PLAY_URL = 'https://play.google.com/store/apps/details?id=in.easyfix.client';
const IOS_URL  = 'https://apps.apple.com/app/easyfix-client/id000000000';

type Plat = 'android' | 'ios';

export function GetAppModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [plat, setPlat] = useState<Plat>('android');
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLCanvasElement>(null);

  // Esc to close + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Illustrative QR — deterministic pattern (NOT a real encodable code).
  useEffect(() => {
    if (!open) return;
    const c = qrRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const N = 25, s = c.width / N;
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#141414';
    const inFinder = (col: number, row: number) =>
      (col < 8 && row < 8) || (col > N - 9 && row < 8) || (col < 8 && row > N - 9);
    for (let r = 0; r < N; r++) for (let col = 0; col < N; col++) {
      if (inFinder(col, r)) continue;
      if (rnd() > 0.52) ctx.fillRect(col * s, r * s, s, s);
    }
    const finder = (x: number, y: number) => {
      ctx.fillRect(x * s, y * s, 7 * s, s); ctx.fillRect(x * s, (y + 6) * s, 7 * s, s);
      ctx.fillRect(x * s, y * s, s, 7 * s); ctx.fillRect((x + 6) * s, y * s, s, 7 * s);
      ctx.fillRect((x + 2) * s, (y + 2) * s, 3 * s, 3 * s);
    };
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
    // brand chip
    const m = Math.floor(N / 2);
    ctx.fillStyle = '#d9212b'; ctx.fillRect((m - 2) * s, (m - 2) * s, 5 * s, 5 * s);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${3.2 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('E', m * s + s / 2, m * s + s / 2 + s * 0.05);
  }, [open]);

  async function copyLink() {
    try { await navigator.clipboard.writeText(APP_LINK); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="getapp-title">
      <button type="button" aria-label="Close" onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-default" />

      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* soft brand ribbon */}
        <div className="absolute inset-x-0 top-0 h-24 pointer-events-none"
          style={{ background: 'radial-gradient(120% 140% at 12% 0%, rgba(217,33,43,.12), transparent 60%), radial-gradient(120% 140% at 100% 0%, rgba(243,156,18,.12), transparent 55%)' }} />

        <button type="button" onClick={onClose} aria-label="Close"
          className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 z-10">
          <X className="w-4 h-4" />
        </button>

        {/* header */}
        <div className="relative px-6 pt-6 flex items-start gap-3">
          <span className="w-11 h-11 rounded-xl grid place-items-center text-white shrink-0"
            style={{ background: 'linear-gradient(160deg,#d9212b,#7f1d1d)', boxShadow: '0 6px 16px -6px rgba(217,33,43,.6)' }}>
            <Smartphone className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h2 id="getapp-title" className="text-lg font-bold text-slate-900">Take EasyFix with you</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Get the mobile app to approve estimates, track technicians live, and act on alerts — from your phone.
            </p>
          </div>
        </div>

        {/* body */}
        <div className="grid grid-cols-1 sm:grid-cols-[1.1fr_.9fr] gap-5 px-6 py-5">
          <div>
            {/* platform tabs */}
            <div className="inline-flex gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1">
              {(['android', 'ios'] as Plat[]).map((p) => (
                <button key={p} type="button" onClick={() => setPlat(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${plat === p ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                  {p === 'android' ? 'Android' : 'iPhone'}
                </button>
              ))}
            </div>

            {/* store badges */}
            <div className="mt-3 flex flex-col gap-2.5">
              <a href={PLAY_URL} target="_blank" rel="noopener noreferrer"
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-white transition hover:-translate-y-0.5 ${plat === 'ios' ? 'opacity-40 grayscale' : ''}`}
                style={{ background: '#0f1116' }}>
                <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" fill="#fff"><path d="M3.6 2.3 13 12 3.6 21.7a1 1 0 0 1-.6-.9V3.2a1 1 0 0 1 .6-.9Zm10.8 8.3 2.6-1.5 3.9 2.2c.8.4.8 1.5 0 2l-3.9 2.2-2.6-1.6L16.8 12l-2.4-1.4Z" /></svg>
                <span className="leading-tight"><span className="block text-[10px] opacity-80 font-semibold">GET IT ON</span><span className="block text-sm font-extrabold">Google Play</span></span>
              </a>
              <a href={IOS_URL} target="_blank" rel="noopener noreferrer"
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-white transition hover:-translate-y-0.5 ${plat === 'android' ? 'opacity-40 grayscale' : ''}`}
                style={{ background: '#0f1116' }}>
                <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" fill="#fff"><path d="M16.4 12.7c0-2 1.6-2.9 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.4 2 2.4 2 1 0 1.3-.6 2.5-.6 1.1 0 1.5.6 2.5.6s1.7-1 2.3-2c.7-1 1-2 1-2 0 0-2-.8-2-3.1ZM14.6 6c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9 0 1.7-.4 2.3-1.1Z" /></svg>
                <span className="leading-tight"><span className="block text-[10px] opacity-80 font-semibold">Download on the</span><span className="block text-sm font-extrabold">App Store</span></span>
              </a>
            </div>

            {/* copy link */}
            <div className="mt-3">
              <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Or send yourself the link</label>
              <div className="mt-1 flex border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                <input readOnly value={APP_LINK} className="flex-1 bg-transparent px-3 py-2 text-sm text-slate-700 outline-none min-w-0" />
                <button type="button" onClick={copyLink}
                  className={`px-3.5 border-l border-slate-200 bg-white text-sm font-bold inline-flex items-center gap-1.5 ${copied ? 'text-emerald-600' : 'text-primary'}`}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          {/* QR */}
          <div className="flex flex-col items-center justify-center text-center bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <div className="relative bg-white rounded-xl p-3" style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.05)' }}>
              <canvas ref={qrRef} width={176} height={176} className="w-40 h-40" style={{ imageRendering: 'pixelated' }} />
            </div>
            <p className="mt-2.5 text-xs text-slate-500 leading-snug max-w-[22ch]">
              Scan with your phone camera — it opens the right store for your device.
            </p>
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 px-6 pb-5">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
