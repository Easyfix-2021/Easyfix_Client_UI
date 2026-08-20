'use client';

/*
 * Customer Feedback page — public, no SPOC login.
 *
 * Ported from the legacy Angular customer-feedback.component +
 * customer-feedback.service. The customer hits this URL from an SMS /
 * WhatsApp / email link AFTER the technician closes the visit:
 *   https://qa.crm.easyfix.in/feedback/479925
 *
 * Layout:
 *   1. Header band — brand red, "Powered by EasyFix" on the right.
 *   2. Client + Job ID summary.
 *   3. Technician avatar + service category + name.
 *   4. 5-emoji rating strip (Terrible → Awesome).
 *   5. Tag chips driven by the chosen rating
 *      (Awesome / Good / Need-Improvement / Bad / Terrible).
 *   6. Free-text review.
 *   7. Submit ("Rate Us") + a "Raise Issue" button that opens an
 *      email-style modal (legacy parity — kept simple for now).
 *
 * Backend contract:
 *   GET  /api/public/feedback/:jobId      → job info + already_rated flag
 *   POST /api/public/feedback/:jobId      → submit { rating, comments, reviewComments }
 *
 * Design choice: this page is intentionally NOT inside the
 * (authed) layout group so the SPOC sidebar / navbar don't render
 * when a customer lands here from a non-logged-in browser.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Loader2, CheckCircle2, AlertCircle, Star, X, Send,
} from 'lucide-react';

type JobInfo = {
  job_id: number;
  job_status: number;
  customer_name: string | null;
  easyfixer_id: number | null;
  easyfixer_name: string | null;
  easyfixer_image: string | null;
  service_category: string | null;
  client_name: string | null;
  already_rated: boolean;
  existing_rating: number | null;
};

/*
 * Three rating-context tag pools — chosen by activeRating (1..5).
 * Matches legacy AwesomeFeedbackOptions / GoodFeedbackOptions /
 * TerribleFeedbackOptions verbatim so historical analytics still
 * align with the new dashboard.
 */
const AWESOME_TAGS = [
  'Skill of technician', 'Punctuality', 'Tool Kit', 'Quality of Work',
  'Behavior', 'Technician', 'Professionalism', 'Grooming',
  'My Experience', 'Good Product Demo',
];
const GOOD_TAGS = [
  'Clarity of instructions', 'Punctuality', 'Tool Kit', 'Quality of Work',
  'Speed of Work', 'Completed on time', 'Professionalism', 'Grooming',
  'Positive Attitude', 'Good Product Demo',
];
const TERRIBLE_TAGS = [
  'Incomplete work', 'Late Start', 'No Skills', 'Quality of Work',
  'Slow', 'Badly Groomed', 'Unprofessional', 'Shabby', 'Behavior',
  'Lack of knowledge',
];

const RATING_LABELS: Record<number, { title: string; subtitle: string; ask: string; tags: string[] }> = {
  5: {
    title: 'Awesome',
    subtitle: 'Great experience — absolutely loved it.',
    ask: 'What did you like?',
    tags: AWESOME_TAGS,
  },
  4: {
    title: 'Good',
    subtitle: 'Fine, but could have been better.',
    ask: 'What could be better?',
    tags: GOOD_TAGS,
  },
  3: {
    title: 'Need Improvement',
    subtitle: 'Some things worked, others didn’t.',
    ask: 'What went wrong?',
    tags: GOOD_TAGS,
  },
  2: {
    title: 'Bad',
    subtitle: 'Did not meet expectations — definitely room to improve.',
    ask: 'What went wrong?',
    tags: GOOD_TAGS,
  },
  1: {
    title: 'Terrible',
    subtitle: 'Far below expectations — needs immense improvement.',
    ask: 'What went wrong?',
    tags: TERRIBLE_TAGS,
  },
};

// Emoji per rating — 5 → 😍 (most positive) … 1 → 😡 (most negative).
const RATING_EMOJI: Record<number, string> = {
  5: '😍',
  4: '🙂',
  3: '😐',
  2: '😕',
  1: '😡',
};

export default function CustomerFeedbackPage() {
  const router = useRouter();
  const { jobId } = useParams<{ jobId: string }>();
  const jobIdNum = Number(jobId);

  const [job, setJob] = useState<JobInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [rating, setRating] = useState<number>(5);           // 1..5, default Awesome
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [showRaiseIssue, setShowRaiseIssue] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(jobIdNum) || jobIdNum <= 0) {
      setLoadError('Invalid job link.');
      setLoading(false);
      return;
    }
    fetch(`/api/public/feedback/${jobIdNum}`)
      .then((r) => r.json())
      .then((body) => {
        if (!body.success) throw new Error(body.error || 'Could not load job');
        setJob(body.data as JobInfo);
        if (body.data?.already_rated) {
          // Match legacy ratingExpired flow.
          setSubmitted(true);
        }
      })
      .catch((err) => setLoadError(err.message || 'Could not load job'))
      .finally(() => setLoading(false));
  }, [jobIdNum]);

  const ctx = RATING_LABELS[rating];

  // Reset selected tags when the rating changes — the tag pool itself
  // changes (good → terrible) so existing selections would be stale.
  function pickRating(r: number) {
    setRating(r);
    setSelectedTags(new Set());
    setSubmitError(null);
  }

  function toggleTag(tag: string) {
    setSelectedTags((s) => {
      const next = new Set(s);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  async function submit() {
    setSubmitError(null);
    if (selectedTags.size === 0) {
      setSubmitError('Please pick at least one tag.');
      return;
    }
    if (!review.trim()) {
      setSubmitError('Please share a quick comment.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/feedback/${jobIdNum}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          comments: review.trim(),
          reviewComments: Array.from(selectedTags).join(', '),
        }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'Submit failed');
      setSubmitted(true);
    } catch (err) {
      setSubmitError((err as Error).message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  // Initials fallback when no technician photo is on file.
  const techInitials = useMemo(() => {
    const name = job?.easyfixer_name || '';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [job?.easyfixer_name]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-ink-50">
        <div className="text-center text-ink-500">
          <Loader2 className="w-8 h-8 animate-spin mx-auto" />
          <p className="mt-3 text-sm">Loading your job…</p>
        </div>
      </div>
    );
  }

  if (loadError || !job) {
    return (
      <div className="min-h-screen grid place-items-center bg-ink-50 px-4">
        <div className="bg-surface rounded-2xl border border-ink-100 shadow-sm p-8 max-w-md text-center">
          <AlertCircle className="w-10 h-10 text-danger mx-auto" />
          <h1 className="text-xl font-semibold text-ink-900 mt-3">Link not valid</h1>
          <p className="text-sm text-ink-500 mt-2">
            {loadError || 'We could not find this job.'} If you received this link via SMS or email,
            please check that the link is complete.
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen grid place-items-center bg-gradient-to-br from-primary-50 via-white to-gold-tint px-4">
        <div className="bg-surface rounded-2xl border border-ink-100 shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-success-tint grid place-items-center mx-auto">
            <CheckCircle2 className="w-9 h-9 text-success" />
          </div>
          <h1 className="text-2xl font-semibold text-ink-900 mt-4">Thank you!</h1>
          <p className="text-sm text-ink-500 mt-2">
            {job.already_rated && job.existing_rating
              ? `Your ${job.existing_rating}-star rating was already recorded for this job.`
              : 'Your feedback has been recorded. We use it to keep our technicians at the top of their game.'}
          </p>
          <div className="mt-6 text-xs text-ink-300 uppercase tracking-[0.18em] font-semibold">
            Powered by <span className="text-primary">EasyFix</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50 pb-12">
      {/* Header band */}
      <div className="bg-gradient-to-r from-primary via-primary-dark to-primary text-white">
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.18em] text-white/80 font-semibold">
              {job.client_name || 'EasyFix Service'}
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold leading-tight mt-0.5">
              How was your service?
            </h1>
          </div>
          <div className="text-right text-xs text-white/85">
            <div>Order ID</div>
            <div className="font-mono font-semibold text-base">#{job.job_id}</div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 -mt-4">
        {/* Technician card */}
        <div className="bg-surface rounded-2xl border border-ink-100 shadow-sm p-4 sm:p-5 flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary via-primary-600 to-primary-dark grid place-items-center text-white font-semibold text-xl shrink-0 ring-2 ring-white shadow-md shadow-primary/20 overflow-hidden">
            {job.easyfixer_image
              ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={job.easyfixer_image.startsWith('http')
                    ? job.easyfixer_image
                    : `/easydoc/upload_jobs/${job.easyfixer_image}`}
                  alt={job.easyfixer_name || 'Technician'}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              )
              : techInitials}
          </div>
          <div className="min-w-0">
            <div className="text-xs text-ink-500 uppercase tracking-wide font-semibold">
              {job.service_category || 'Service'}
            </div>
            <div className="text-lg font-semibold text-ink-900 leading-tight truncate">
              With {job.easyfixer_name || 'EasyFix Technician'}
            </div>
            {job.customer_name && (
              <div className="text-xs text-ink-500 mt-0.5">
                Hi {job.customer_name.replace(/^Mr\.?\s+|^Ms\.?\s+|^Mrs\.?\s+/i, '').split(' ')[0] || job.customer_name}, please share your experience.
              </div>
            )}
          </div>
        </div>

        {/* Rating emojis */}
        <div className="bg-surface rounded-2xl border border-ink-100 shadow-sm p-4 sm:p-5 mt-4">
          <h2 className="text-sm font-semibold text-ink-700 mb-3 uppercase tracking-wider">
            How was your experience?
          </h2>
          <div className="flex justify-between sm:justify-around items-center">
            {[1, 2, 3, 4, 5].map((r) => {
              const on = rating === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => pickRating(r)}
                  className={`text-3xl sm:text-4xl transition-transform p-2 rounded-full ${
                    on ? 'scale-125 bg-primary/10 ring-2 ring-primary' : 'scale-100 opacity-50 hover:opacity-90 hover:scale-110'
                  }`}
                  aria-label={`Rate ${RATING_LABELS[r].title}`}
                  title={RATING_LABELS[r].title}
                >
                  {RATING_EMOJI[r]}
                </button>
              );
            })}
          </div>
          <div className="text-center mt-4">
            <div className="text-lg sm:text-xl font-semibold text-ink-900">{ctx.title}</div>
            <div className="text-sm text-ink-500 mt-1">{ctx.subtitle}</div>
          </div>
        </div>

        {/* Tag picker */}
        <div className="bg-surface rounded-2xl border border-ink-100 shadow-sm p-4 sm:p-5 mt-4">
          <h2 className="text-sm font-semibold text-ink-700 mb-3 uppercase tracking-wider">
            {ctx.ask}
          </h2>
          <div className="flex flex-wrap gap-2">
            {ctx.tags.map((tag) => {
              const on = selectedTags.has(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-semibold border transition ${
                    on
                      ? 'bg-primary text-white border-primary shadow-sm shadow-primary/30'
                      : 'bg-surface text-ink-700 border-ink-100 hover:border-primary/40 hover:bg-primary/5'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* Review textarea */}
        <div className="bg-surface rounded-2xl border border-ink-100 shadow-sm p-4 sm:p-5 mt-4">
          <h2 className="text-sm font-semibold text-ink-700 mb-3 uppercase tracking-wider">
            A quick comment
          </h2>
          <textarea
            rows={3}
            className="w-full rounded-lg border border-ink-100 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none resize-y"
            placeholder="Tell us a bit about your experience…"
            value={review}
            onChange={(e) => setReview(e.target.value)}
          />
        </div>

        {submitError && (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger-tint text-danger-text text-sm px-3 py-2 inline-flex items-center gap-2 w-full">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {submitError}
          </div>
        )}

        {/* Submit + Raise Issue */}
        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl text-white font-semibold text-sm shadow-md shadow-primary/30 bg-gradient-to-br from-primary to-primary-dark hover:opacity-95 transition disabled:opacity-60"
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
              : <><Star className="w-4 h-4 fill-current" /> Submit Rating</>}
          </button>
          <button
            type="button"
            onClick={() => setShowRaiseIssue(true)}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl text-ink-700 font-semibold text-sm border border-ink-100 bg-surface hover:border-ink-300 transition"
          >
            <Send className="w-4 h-4" /> Raise an issue
          </button>
        </div>

        {/* Powered-by footer */}
        <div className="text-center mt-6 text-xs uppercase tracking-[0.18em] text-ink-300 font-semibold">
          Powered by <span className="text-primary">EasyFix</span>
        </div>
      </div>

      {/* Raise Issue modal — keeps the legacy "email ops" affordance. */}
      {showRaiseIssue && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm grid place-items-center px-4"
          onClick={() => setShowRaiseIssue(false)}
        >
          <div
            className="bg-surface rounded-2xl shadow-2xl max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-ink-900">Raise an issue</h3>
              <button
                type="button"
                onClick={() => setShowRaiseIssue(false)}
                className="w-8 h-8 rounded-full hover:bg-ink-100 grid place-items-center text-ink-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-ink-500 mb-4">
              For urgent issues, please email{' '}
              <a
                href={`mailto:solutions@easyfix.in?subject=${encodeURIComponent(`${job.client_name || 'EasyFix'} — Order #${job.job_id}`)}&body=${encodeURIComponent(`Job #${job.job_id}\nTechnician: ${job.easyfixer_name || ''}\n\nIssue:\n`)}`}
                className="text-primary font-semibold underline"
              >
                solutions@easyfix.in
              </a>{' '}
              with your order ID <span className="font-mono font-semibold">#{job.job_id}</span>.
            </p>
            <button
              type="button"
              onClick={() => setShowRaiseIssue(false)}
              className="w-full py-2.5 rounded-lg text-sm font-semibold border border-ink-100 hover:bg-ink-50 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
