import './globals.css';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';

/*
 * IBM Plex Sans + IBM Plex Mono — the faces the EasyFix brand identity
 * document specifies. This replaced Mulish, which was never in the identity.
 *
 * Mono is loaded as a CSS VARIABLE rather than a className because it is not
 * the page face: it is applied per-element to job references, money and any
 * tabular figure, via the `font-mono` Tailwind utility. Loading it as a second
 * className would have it fight Plex Sans for the <html> element.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  /*
   * 400 / 500 / 600 ONLY. The identity's type scale stops at semibold, and
   * scripts/check-brand-tokens.js fails the build on `font-bold` or a
   * fontWeight above 600 — but a weight that is never loaded cannot be reached
   * at all, not even through an arbitrary value or a third-party stylesheet.
   * 700 was being downloaded here and was both off-identity and dead weight.
   */
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata = {
  title: 'EasyFix Client Portal',
  description: 'Client SPOC dashboard for the EasyFix workorder platform',
  /*
   * Brand Kit §7.2. There was no `icons` field at all, so the only tab icon
   * was whatever the src/app/icon.svg file convention emitted — no PNG
   * fallback for a browser that will not take an SVG favicon, and no
   * apple-touch-icon, which left iOS to screenshot the page for a home-screen
   * bookmark.
   *
   * ⚠ EVERY FILE HERE IS THE KIT'S OWN OUTPUT, COPIED BYTE FOR BYTE.
   *
   * They are the RED colourway — apps/client-dashboard/web/*-red.* — because
   * this portal's tab icon is the red inverse. The kit's web/ set used to be
   * built only from favicon.svg, the LIGHT colourway, which left two bad
   * options: declare the light PNG and let every browser that prefers PNG
   * over SVG show a white tile, or hand-roll the set here and fork the
   * identity away from the kit. Neither is acceptable, so the kit grew the
   * red set instead (build.js, the `kind === "web"` block) and this copies
   * it. Regenerate there, never here.
   */
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${plexSans.className}`}>
      <body>{children}</body>
    </html>
  );
}
