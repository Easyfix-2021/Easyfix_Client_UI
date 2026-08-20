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
import { useEffect, useState } from 'react';
import { X, Copy, Check, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
/*
 * The QR mark below is serialised into a data-URI STRING and the QR
 * component's bgColor/fgColor are raw-string props — a `var()` cannot
 * resolve in either, so those three call sites read the token map
 * directly. No colour literal appears in this file.
 */
import { tokens } from '@/brand/tokens';

// ─── Store links (both live) ───────────────────────────────────────────
const IOS_URL  = 'https://apps.apple.com/in/app/easyfixclient/id6793440274';
const PLAY_URL = 'https://play.google.com/store/apps/details?id=in.easyfix.client';

// Compact EasyFix mark (red house on a white rounded square) for the QR
// centre. Inlined as a data URI so it needs no network request.
const QR_LOGO =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">' +
      `<rect width="48" height="48" rx="11" fill="${tokens.white}"/>` +
      `<path d="M24 11 L39 24 h-4 v13 H13 V24 H9 Z" fill="${tokens['red-500']}"/>` +
      `<rect x="21" y="28" width="6" height="9" fill="${tokens.white}"/>` +
    '</svg>',
  );

type Plat = 'android' | 'ios';

export function GetAppModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [plat, setPlat] = useState<Plat>('ios');
  const [copied, setCopied] = useState(false);

  // The QR encodes the store link for the selected platform, so scanning it
  // opens the right listing. iOS is live today; Android follows once PLAY_URL
  // points at the real listing.
  const qrValue = plat === 'ios' ? IOS_URL : PLAY_URL;

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


  async function copyLink() {
    try { await navigator.clipboard.writeText(qrValue); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="getapp-title">
      <button type="button" aria-label="Close" onClick={onClose}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm cursor-default" />

      <div className="relative w-full max-w-xl bg-surface rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* soft brand ribbon */}
        <div className="absolute inset-x-0 top-0 h-24 pointer-events-none"
          style={{ background: 'radial-gradient(120% 140% at 12% 0%, rgb(var(--ef-red-500-rgb) / 0.12), transparent 60%), radial-gradient(120% 140% at 100% 0%, rgb(var(--ef-gold-rgb) / 0.12), transparent 55%)' }} />

        <button type="button" onClick={onClose} aria-label="Close"
          className="absolute top-3 right-3 p-1.5 rounded-lg text-ink-300 hover:bg-ink-100 hover:text-ink-700 z-10">
          <X className="w-4 h-4" />
        </button>

        {/* header */}
        <div className="relative px-6 pt-6 flex items-start gap-3">
          <span className="w-11 h-11 rounded-xl grid place-items-center text-white shrink-0"
            style={{ background: 'linear-gradient(160deg,var(--ef-red-500),var(--ef-red-700))', boxShadow: '0 6px 16px -6px rgb(var(--ef-red-500-rgb) / 0.6)' }}>
            <Smartphone className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h2 id="getapp-title" className="text-lg font-semibold text-ink-900">Take EasyFix with you</h2>
            <p className="mt-0.5 text-sm text-ink-500">
              Get the mobile app to approve estimates, track technicians live, and act on alerts — from your phone.
            </p>
          </div>
        </div>

        {/* body */}
        <div className="grid grid-cols-1 sm:grid-cols-[1.1fr_.9fr] gap-5 px-6 py-5">
          <div>
            {/* platform tabs */}
            <div className="inline-flex gap-1 bg-ink-50 border border-ink-100 rounded-xl p-1">
              {(['android', 'ios'] as Plat[]).map((p) => (
                <button key={p} type="button" onClick={() => setPlat(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${plat === p ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500'}`}>
                  {p === 'android' ? 'Android' : 'iPhone'}
                </button>
              ))}
            </div>

            {/* store badges */}
            <div className="mt-3 flex flex-col gap-2.5">
              {/* Buttons (not <a href>) so no store URL shows on hover, and
                  clicking does NOT navigate — it copies the link instead. The
                  QR scanner + copy field are the ways to get the app. */}
              <button type="button"
                onClick={copyLink}
                className={`w-full text-left flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-white transition hover:-translate-y-0.5 ${plat === 'ios' ? 'opacity-40 grayscale' : ''}`}
                style={{ background: 'var(--ef-ink-900)' }}>
                <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" fill="currentColor"><path d="M3.6 2.3 13 12 3.6 21.7a1 1 0 0 1-.6-.9V3.2a1 1 0 0 1 .6-.9Zm10.8 8.3 2.6-1.5 3.9 2.2c.8.4.8 1.5 0 2l-3.9 2.2-2.6-1.6L16.8 12l-2.4-1.4Z" /></svg>
                <span className="leading-tight"><span className="block text-xs opacity-80 font-semibold">GET IT ON</span><span className="block text-sm font-semibold">Google Play</span></span>
              </button>
              <button type="button"
                onClick={copyLink}
                className={`w-full text-left flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-white transition hover:-translate-y-0.5 ${plat === 'android' ? 'opacity-40 grayscale' : ''}`}
                style={{ background: 'var(--ef-ink-900)' }}>
                <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" fill="currentColor"><path d="M16.4 12.7c0-2 1.6-2.9 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.4 2 2.4 2 1 0 1.3-.6 2.5-.6 1.1 0 1.5.6 2.5.6s1.7-1 2.3-2c.7-1 1-2 1-2 0 0-2-.8-2-3.1ZM14.6 6c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9 0 1.7-.4 2.3-1.1Z" /></svg>
                <span className="leading-tight"><span className="block text-xs opacity-80 font-semibold">Download on the</span><span className="block text-sm font-semibold">App Store</span></span>
              </button>
            </div>

            {/* copy link */}
            <div className="mt-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-ink-500">Or send yourself the link</label>
              <div className="mt-1 flex items-start gap-2 border border-ink-100 rounded-xl bg-ink-50 p-2.5">
                <span className="flex-1 min-w-0 text-sm text-ink-700 break-all leading-snug pt-1.5">{qrValue}</span>
                <button type="button" onClick={copyLink}
                  className={`shrink-0 self-stretch px-3 rounded-lg border border-ink-100 bg-surface text-sm font-semibold inline-flex items-center gap-1.5 ${copied ? 'text-success' : 'text-primary'}`}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          {/* QR */}
          <div className="flex flex-col items-center justify-center text-center bg-ink-50 border border-ink-100 rounded-2xl p-4">
            <div className="relative bg-surface rounded-xl p-3" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--ef-ink-900-rgb) / 0.05)' }}>
              <QRCodeSVG
                value={qrValue}
                size={160}
                level="Q"
                bgColor={tokens.white}
                fgColor={tokens['ink-900']}
                imageSettings={{ src: QR_LOGO, height: 34, width: 34, excavate: true }}
                className="w-40 h-40"
              />
            </div>
            <p className="mt-2.5 text-xs text-ink-500 leading-snug max-w-[22ch]">
              Scan with your phone camera to open the {plat === 'ios' ? 'App Store' : 'Play Store'} listing.
            </p>
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 px-6 pb-5">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-ink-500 hover:bg-ink-100">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
