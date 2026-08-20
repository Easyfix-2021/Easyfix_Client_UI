'use client';

/*
 * Client SPOC login — replicates the legacy Angular_ClientDashboard
 * landing-page layout (background.png + Sign In / Know More header +
 * left form / right phone mockup) and the floating social-media widget.
 *
 * Backend endpoints used:
 *   POST /api/client/auth/login-otp  (sends OTP)
 *   POST /api/client/auth/verify-otp (returns token)
 *   POST /api/client/auth/signup     (sends verification email — Phase 4 work)
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Logo } from '@/components/brand/logo';
import {
  Headphones,
  Facebook,
  Instagram,
  Linkedin,
  MessageCircle,
  Youtube,
  X,
} from 'lucide-react';
import { api, ApiError, setToken, getToken } from '@/lib/api';
import { vendor } from '@/brand/charts';

type View = 'signin' | 'signup';
type Step = 'identifier' | 'otp';

/*
 * `bg` is each network's OWN mark, taken from the vendor map in
 * src/brand/charts.ts — WhatsApp green belongs to WhatsApp, so a rebrand
 * must not repaint it. Applied as an inline background rather than a
 * Tailwind class for the same reason: it is not a token.
 */
const SOCIAL_LINKS: Array<{
  label: string;
  href: string;
  Icon: typeof Facebook;
  bg: string;
}> = [
  { label: 'Facebook',  href: 'https://www.facebook.com/easyfixservices',  Icon: Facebook,      bg: vendor.facebook },
  { label: 'Instagram', href: 'https://www.instagram.com/easyfixservices', Icon: Instagram,     bg: vendor.instagram },
  { label: 'LinkedIn',  href: 'https://www.linkedin.com/company/easyfix',  Icon: Linkedin,      bg: vendor.linkedin },
  { label: 'WhatsApp',  href: 'https://wa.me/919999999999',                Icon: MessageCircle, bg: vendor.whatsapp },
  { label: 'YouTube',   href: 'https://www.youtube.com/@easyfix',          Icon: Youtube,       bg: vendor.youtube },
];

export default function LoginPage() {
  const router = useRouter();
  const [view, setView] = useState<View>('signin');
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [clientId, setClientId] = useState('');
  const [email, setEmail] = useState('');
  const [signupSent, setSignupSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [socialOpen, setSocialOpen] = useState(false);
  const socialRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (getToken()) router.push('/dashboard');
  }, [router]);

  useEffect(() => {
    if (!socialOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (socialRef.current && !socialRef.current.contains(e.target as Node)) {
        setSocialOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setSocialOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [socialOpen]);

  function switchView(v: View) {
    setView(v);
    setStep('identifier');
    setOtp('');
    setError(null);
    setSignupSent(false);
  }

  async function sendOtp(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null); setLoading(true);
    try {
      await api.post<{ delivered: boolean }>('/auth/login-otp', { identifier: identifier.trim() });
      setStep('otp');
      setOtp('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send OTP');
    } finally { setLoading(false); }
  }

  async function verifyOtp(value?: string) {
    const otpStr = (value ?? otp).trim();
    if (otpStr.length !== 4) return;
    setError(null); setLoading(true);
    try {
      const res = await api.post<{ token: string }>('/auth/verify-otp', {
        identifier: identifier.trim(),
        otp: Number(otpStr),
      });
      setToken(res.token);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid OTP');
      setOtp('');
    } finally { setLoading(false); }
  }

  function onOtpChange(val: string) {
    const clean = val.replace(/\D/g, '').slice(0, 4);
    setOtp(clean);
    if (clean.length === 4) {
      setTimeout(() => void verifyOtp(clean), 60);
    }
  }

  async function submitSignup(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null); setLoading(true);
    try {
      await api.post('/auth/signup', { clientId: clientId.trim(), email: email.trim() });
      setSignupSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Signup failed. Please contact your account manager.');
    } finally { setLoading(false); }
  }

  return (
    <main
      className="relative min-h-screen w-full overflow-x-hidden bg-surface bg-no-repeat bg-cover bg-center"
      style={{ backgroundImage: "url('/background.png')" }}
    >
      {/* Header — Sign In / Know More on the left, EasyFix logo centered over the right column */}
      <header className="relative z-10 px-4 sm:px-8 md:px-16 pt-6 md:pt-10">
        <div className="grid grid-cols-1 md:grid-cols-2 items-center gap-4">
          <nav className="flex items-center gap-6 md:gap-14">
            <button
              type="button"
              onClick={() => switchView('signin')}
              className={`text-white text-xl md:text-3xl font-medium tracking-wide pb-1 transition border-b-2 ${
                view === 'signin' ? 'border-white' : 'border-transparent hover:border-white/60'
              }`}
            >
              Sign In
            </button>
            <a
              href="https://www.easyfix.in/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white text-xl md:text-3xl font-medium tracking-wide pb-1 border-b-2 border-transparent hover:border-white/60 transition"
            >
              Know More
            </a>
          </nav>
          <div className="hidden md:flex justify-center">
            <Logo priority className="h-16 lg:h-20 w-auto" />
          </div>
        </div>
      </header>

      {/* Body — left form / right phone */}
      <section className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-8 px-6 sm:px-10 md:px-16 mt-6 md:mt-8 pb-16">
        {/* Left column */}
        <div className="flex flex-col justify-center max-w-xl">
          {view === 'signin' && step === 'identifier' && (
            <>
              <h1 className="text-white font-semibold text-3xl md:text-5xl leading-tight tracking-wide">
                Power up your customer support
              </h1>
              <p className="text-white text-lg md:text-2xl font-medium mt-6 md:mt-8">
                Easyfix is trusted by over 100,000 customers
              </p>

              <form onSubmit={sendOtp} className="mt-8 md:mt-10 space-y-5 max-w-md">
                <input
                  autoFocus
                  type="text"
                  className="w-full rounded-xl px-4 py-4 text-base bg-surface text-ink-900 placeholder:text-ink-300 outline-none focus:ring-2 focus:ring-white/80 shadow"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Registered Mobile Number or Email Address"
                />
                <button
                  type="submit"
                  disabled={loading || !identifier.trim()}
                  className="rounded-xl bg-white/95 text-primary font-semibold px-12 py-3 text-base hover:bg-white transition disabled:opacity-60 disabled:cursor-not-allowed shadow"
                >
                  {loading ? 'Sending OTP…' : 'Send OTP'}
                </button>
              </form>

              <p className="text-white mt-6 max-w-md">
                Not a member ?{' '}
                <button
                  type="button"
                  onClick={() => switchView('signup')}
                  className="text-white font-semibold underline underline-offset-2"
                >
                  Signup Now
                </button>
              </p>
            </>
          )}

          {view === 'signin' && step === 'otp' && (
            <>
              <h1 className="text-white font-semibold text-3xl md:text-5xl leading-tight tracking-wide">
                Verify your OTP
              </h1>
              <p className="text-white text-base md:text-xl font-medium mt-4">
                We sent a 4-digit code to <span className="font-semibold">{identifier}</span>
              </p>

              <form onSubmit={(e) => { e.preventDefault(); void verifyOtp(); }} className="mt-8 md:mt-10 space-y-5 max-w-md">
                <input
                  autoFocus
                  inputMode="numeric"
                  maxLength={4}
                  type="text"
                  disabled={loading}
                  className="w-full rounded-xl px-4 py-4 text-2xl tracking-[0.6em] text-center font-semibold bg-surface text-ink-900 placeholder:text-ink-300 placeholder:tracking-normal placeholder:text-base placeholder:font-normal outline-none focus:ring-2 focus:ring-white/80 shadow disabled:opacity-60"
                  value={otp}
                  onChange={(e) => onOtpChange(e.target.value)}
                  placeholder="Enter OTP"
                />
                {loading && (
                  <p className="text-white font-semibold inline-flex items-center gap-2">
                    <span
                      className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"
                      aria-hidden
                    />
                    Verifying…
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => { setStep('identifier'); setOtp(''); setError(null); }}
                    className="text-white/90 hover:text-white text-sm md:text-base"
                  >
                    ← Change number
                  </button>
                  <button
                    type="button"
                    onClick={() => sendOtp()}
                    disabled={loading}
                    className="text-white font-semibold underline underline-offset-2 text-sm md:text-base disabled:opacity-50"
                  >
                    Resend OTP
                  </button>
                </div>
              </form>
            </>
          )}

          {view === 'signup' && !signupSent && (
            <>
              <h1 className="text-white font-semibold text-3xl md:text-5xl leading-tight tracking-wide">
                Create Account
              </h1>
              <p className="text-white text-base md:text-lg mt-4 max-w-md">
                Enter your Client ID and registered email to receive a verification link.
              </p>

              <form onSubmit={submitSignup} className="mt-8 md:mt-10 space-y-4 max-w-md">
                <input
                  autoFocus
                  type="text"
                  className="w-full rounded-xl px-4 py-4 text-base bg-surface text-ink-900 placeholder:text-ink-300 outline-none focus:ring-2 focus:ring-white/80 shadow"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Client Id"
                />
                <input
                  type="email"
                  className="w-full rounded-xl px-4 py-4 text-base bg-surface text-ink-900 placeholder:text-ink-300 outline-none focus:ring-2 focus:ring-white/80 shadow"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email Id"
                />
                <button
                  type="submit"
                  disabled={loading || !clientId.trim() || !email.trim()}
                  className="rounded-xl bg-white/95 text-primary font-semibold px-12 py-3 text-base hover:bg-white transition disabled:opacity-60 disabled:cursor-not-allowed shadow"
                >
                  {loading ? 'Sending…' : 'Sign Up'}
                </button>
              </form>

              <p className="text-white mt-6">
                Already a member ?{' '}
                <button
                  type="button"
                  onClick={() => switchView('signin')}
                  className="text-white font-semibold underline underline-offset-2"
                >
                  Sign In
                </button>
              </p>
            </>
          )}

          {view === 'signup' && signupSent && (
            <>
              <h1 className="text-white font-semibold text-3xl md:text-4xl leading-tight tracking-wide">
                Verification email sent
              </h1>
              <p className="text-white text-base md:text-lg mt-4 max-w-md">
                We&apos;ve sent a verification link to{' '}
                <span className="font-semibold">{email}</span>. The link is valid for 2 hours.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 max-w-md text-sm md:text-base">
                <button
                  type="button"
                  onClick={() => setSignupSent(false)}
                  className="text-white font-semibold underline underline-offset-2"
                >
                  Change email
                </button>
                <button
                  type="button"
                  onClick={() => submitSignup()}
                  className="text-white font-semibold underline underline-offset-2"
                >
                  Resend email
                </button>
                <button
                  type="button"
                  onClick={() => switchView('signin')}
                  className="text-white/90 hover:text-white"
                >
                  Back to Sign In
                </button>
              </div>
            </>
          )}
        </div>

        {/* Right column — phone mockup (logo lives in the header, centered above this column) */}
        <div className="hidden md:flex items-center justify-center">
          <Image
            src="/mobileTrans.png"
            alt="EasyFix mobile app preview"
            width={420}
            height={840}
            priority
            className="max-h-[72vh] w-auto drop-shadow-2xl"
          />
        </div>
      </section>

      {/* Error modal — centred popup matching the legacy Angular SweetAlert
          dialog. Triggered whenever `error` is set (failed OTP send /
          verify / signup, or the inactive-client guard from the backend). */}
      {error && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="error-modal-title"
          onClick={() => setError(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-surface shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-8 pt-8 pb-6 text-center">
              <h2
                id="error-modal-title"
                className="text-3xl font-semibold text-ink-900"
              >
                Error
              </h2>
              <p className="mt-5 text-ink-700 leading-relaxed">{error}</p>
            </div>
            <div className="pb-8 flex justify-center">
              <button
                type="button"
                autoFocus
                onClick={() => setError(null)}
                className="rounded-md bg-[var(--ok-btn)] hover:bg-[var(--ok-btn-hover)] text-white font-semibold px-10 py-2.5 shadow transition"
                /*
                 * The legacy SweetAlert dialog's confirm blue, which the
                 * vendor map carries as `playStore` / `playStorePressed`
                 * — somebody else's colour, so it stays out of the token
                 * set. Piped through custom properties because a hover
                 * state cannot be expressed as an inline style.
                 */
                style={{
                  '--ok-btn': vendor.playStore,
                  '--ok-btn-hover': vendor.playStorePressed,
                } as React.CSSProperties}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating social widget — fixed bottom-right, expands upward */}
      <div
        ref={socialRef}
        className="fixed bottom-6 right-6 z-50 flex flex-col items-center gap-3"
      >
        {/* Expanding icon stack — sits above the trigger; expands upward via opacity + translate */}
        <div
          className={`flex flex-col items-center gap-3 transition-all duration-300 ease-out ${
            socialOpen
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
          aria-hidden={!socialOpen}
        >
          {SOCIAL_LINKS.map(({ label, href, Icon, bg }, i) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="w-11 h-11 rounded-full text-white flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-transform"
              style={{ backgroundColor: bg, transitionDelay: socialOpen ? `${i * 40}ms` : '0ms' }}
            >
              <Icon className="w-5 h-5" strokeWidth={2} />
            </a>
          ))}
        </div>

        {/* Trigger button */}
        <button
          type="button"
          onClick={() => setSocialOpen((v) => !v)}
          aria-label={socialOpen ? 'Close contact options' : 'Open contact options'}
          aria-expanded={socialOpen}
          className="w-14 h-14 rounded-full bg-surface text-primary shadow-xl ring-1 ring-primary/20 hover:scale-105 active:scale-95 transition flex items-center justify-center"
        >
          {socialOpen ? <X className="w-6 h-6" /> : <Headphones className="w-6 h-6" />}
        </button>
      </div>
    </main>
  );
}
