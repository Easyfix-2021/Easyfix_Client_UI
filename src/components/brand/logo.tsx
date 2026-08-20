/**
 * The EasyFix mark — the ONE component allowed to name a logo asset path.
 *
 * WHY THIS EXISTS. A logo file gets replaced far more often than it gets added:
 * a new mark, a festival treatment, a transparent variant, a retina swap. Every
 * page that spells the path itself is a place the swap can be missed, and a
 * stale mark is the most visible possible branding failure — it is the thing a
 * customer recognises before they read a word.
 *
 * So the path lives here once, and `scripts/check-brand-tokens.js` fails the
 * build on an `<Image src="/logo…">` anywhere else. Easyfix_CRM_UI keeps the
 * same rule, in a file of the same name, for the same reason.
 *
 * NOT COVERED, DELIBERATELY: `ClientLogoTile` in (authed)/layout.tsx renders the
 * CUSTOMER's logo from a URL the API supplies. That is data, not an asset of
 * ours, and it must never route through here — a rebrand of EasyFix does not
 * change a client's mark. `mobileTrans.png` on the landing page is a phone
 * mockup, not a mark, and is likewise none of this component's business.
 */
import Image from 'next/image';

/**
 * The asset path. The ONLY occurrence of it in the app.
 *
 * This is the client-dashboard cut of the EasyFix wordmark from the brand kit
 * (`apps/client-dashboard/svg/wordmark-onlight.svg`) — the ink-on-light variant,
 * which is what the console's light titlebar needs. It is a WORDMARK, not the
 * full lockup: the titlebar reads "EasyFix / <client>", so the mark and the
 * client name are already doing the work a tagline lockup would repeat.
 *
 * It replaced `/logoTrans.png`, a raster of unknown provenance that predated the
 * brand kit. SVG also means the titlebar mark stays crisp at any density without
 * shipping a 2x and 3x.
 *
 * If an on-dark or red variant is ever needed, add a `variant` prop HERE rather
 * than a second path at a call site — the whole point is that there is one owner.
 */
const LOGO_SRC = '/brand/wordmark-onlight.svg';

/**
 * The wordmark's intrinsic aspect ratio (viewBox 0 0 1000 196.327), so
 * next/image reserves the right box and the titlebar does not reflow on load.
 */
const INTRINSIC = { width: 1000, height: 196 } as const;

export function Logo({
  className,
  priority = false,
  alt = 'EasyFix',
}: {
  /** Sizing is the caller's job — pass a height plus `w-auto`. */
  className?: string;
  /** Set on an above-the-fold placement so Next preloads instead of lazy-loading. */
  priority?: boolean;
  /**
   * Override only when the mark sits beside a text wordmark, in which case pass
   * `''` so a screen reader does not announce the brand name twice.
   */
  alt?: string;
}) {
  return (
    <Image
      src={LOGO_SRC}
      alt={alt}
      width={INTRINSIC.width}
      height={INTRINSIC.height}
      priority={priority}
      className={className}
    />
  );
}

export default Logo;
