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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${plexSans.className}`}>
      <body>{children}</body>
    </html>
  );
}
