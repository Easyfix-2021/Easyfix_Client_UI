import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /*
         * Every colour below is `rgb(var(--x-rgb) / <alpha-value>)`, NOT a
         * bare `var(--x)` holding a hex. Tailwind rewrites <alpha-value> per
         * utility, which is what makes bg-primary/10 and ring-primary/20 work.
         * A finished var() compiles to a colour with no alpha slot and every
         * opacity modifier silently renders at full strength.
         *
         * Triples live in src/styles/brand-tokens.css beside their hexes.
         *
         * `primary` was #d9212b, which the EasyFix Brand Kit README names
         * explicitly as one of four WRONG reds. The identity document says
         * #C42430.
         */
        primary: 'rgb(var(--ef-red-500-rgb) / <alpha-value>)',
        'primary-dark': 'rgb(var(--ef-red-700-rgb) / <alpha-value>)',
        'primary-600': 'rgb(var(--ef-red-600-rgb) / <alpha-value>)',
        'primary-50': 'rgb(var(--ef-red-50-rgb) / <alpha-value>)',
        'primary-100': 'rgb(var(--ef-red-100-rgb) / <alpha-value>)',
        accent: 'rgb(var(--ef-gold-rgb) / <alpha-value>)',

        // Nav chrome — dark masthead / sidebar against a white working surface.
        chrome: {
          DEFAULT: 'rgb(var(--ef-chrome-bg-rgb) / <alpha-value>)',
          line: 'rgb(var(--ef-chrome-line-rgb) / <alpha-value>)',
          fg: 'rgb(var(--ef-chrome-fg-rgb) / <alpha-value>)',
          muted: 'rgb(var(--ef-chrome-fg-2-rgb) / <alpha-value>)',
          red: 'rgb(var(--ef-chrome-red-rgb) / <alpha-value>)',
          'red-fg': 'rgb(var(--ef-chrome-red-fg-rgb) / <alpha-value>)',

          /*
           * The alpha-derived chrome values — white at low opacity over the dark
           * ground, for a surface that is "slightly lighter than what it sits
           * on". They are RELATIONSHIPS, not palette entries, which is why
           * gen-brand-css.mjs emits them as finished rgba() rather than as
           * channel triplets.
           *
           * That is also why these four are bare `var()` and not the
           * `rgb(var(--x-rgb) / <alpha-value>)` form every colour above uses:
           * there is no triplet to rewrite, because the alpha is already baked
           * in. The trade-off is that an opacity modifier (`bg-chrome-hover/50`)
           * will NOT work on them — correct, since compounding an alpha onto an
           * alpha is not a thing anyone means to do.
           *
           * `hover` was MISSING here while layout.tsx used `bg-chrome-hover` for
           * both the active nav item and its hover state, so Tailwind emitted no
           * rule and the sidebar's active background silently never rendered.
           */
          hover: 'var(--ef-chrome-hover)',
          sunk: 'var(--ef-chrome-sunk)',
          edge: 'var(--ef-chrome-edge)',
          'fg-3': 'var(--ef-chrome-fg-3)',
        },

        // The cool-biased ink ramp the identity document specifies.
        ink: {
          900: 'rgb(var(--ef-ink-900-rgb) / <alpha-value>)',
          700: 'rgb(var(--ef-ink-700-rgb) / <alpha-value>)',
          500: 'rgb(var(--ef-ink-500-rgb) / <alpha-value>)',
          300: 'rgb(var(--ef-ink-300-rgb) / <alpha-value>)',
          100: 'rgb(var(--ef-ink-100-rgb) / <alpha-value>)',
          50: 'rgb(var(--ef-ink-50-rgb) / <alpha-value>)',
        },

        // Meaning colours — state only, never identity.
        success: 'rgb(var(--ef-success-rgb) / <alpha-value>)',
        'success-tint': 'rgb(var(--ef-success-tint-rgb) / <alpha-value>)',
        'success-text': 'rgb(var(--ef-success-text-rgb) / <alpha-value>)',
        warning: 'rgb(var(--ef-warning-rgb) / <alpha-value>)',
        'warning-tint': 'rgb(var(--ef-warning-tint-rgb) / <alpha-value>)',
        'warning-text': 'rgb(var(--ef-warning-text-rgb) / <alpha-value>)',
        money: 'rgb(var(--ef-blue-900-rgb) / <alpha-value>)',
        link: 'rgb(var(--ef-blue-500-rgb) / <alpha-value>)',

        /*
         * ── Surfaces ────────────────────────────────────────────────────────
         * `bg-surface` is the card/panel ground and `bg-surface-alt` the page
         * ground beneath it. They exist so a component can say WHAT a surface
         * is rather than what colour it happens to be today: `bg-white` asserts
         * "this is white", which is a fact about the palette, not about the
         * element. If the identity ever moves the card ground off pure white —
         * warm paper, a hair of ink — `bg-white` would be the wrong thing to
         * change and `bg-surface` the right one.
         */
        surface: 'rgb(var(--ef-white-rgb) / <alpha-value>)',
        'surface-alt': 'rgb(var(--ef-ink-50-rgb) / <alpha-value>)',

        /*
         * Tailwind's stock `white` (a bare #fff) REPLACED by the palette's, so
         * the uses that legitimately remain — `text-white` as ink on a coloured
         * ground, and the `bg-white/90` frost pattern — resolve through the
         * rebrand seam like everything else. Same value today; the difference is
         * that it is now reachable. Only OPAQUE `bg-white` is a violation, and
         * only because `surface` says it better.
         */
        white: 'rgb(var(--ef-white-rgb) / <alpha-value>)',

        /*
         * Tint/on-tint partners for the families that only exposed a solid.
         *
         * These are not new colours — every one already existed as a token in
         * src/brand/tokens.ts and shipped in brand-tokens.css. They simply had
         * no Tailwind name, so a status chip that wanted "blue tint behind blue
         * text" had no way to ask for it and reached for `bg-blue-50` instead.
         * That gap is most of why the raw-palette count reached four figures:
         * the solids were tokenised and the backgrounds they sit on were not.
         *
         * `danger` is a deliberate ALIAS of the red family, not a second error
         * palette — palette.ts says urgent/error reuse red600/red100/red700, and
         * these names let a component say which of the two it means. `primary`
         * is the brand acting; `danger` is the same red warning.
         */
        danger: 'rgb(var(--ef-red-600-rgb) / <alpha-value>)',
        'danger-tint': 'rgb(var(--ef-red-100-rgb) / <alpha-value>)',
        'danger-text': 'rgb(var(--ef-red-700-rgb) / <alpha-value>)',
        info: 'rgb(var(--ef-blue-500-rgb) / <alpha-value>)',
        'info-tint': 'rgb(var(--ef-blue-100-rgb) / <alpha-value>)',
        'info-text': 'rgb(var(--ef-blue-700-rgb) / <alpha-value>)',
        gold: 'rgb(var(--ef-gold-rgb) / <alpha-value>)',
        'gold-tint': 'rgb(var(--ef-gold-tint-rgb) / <alpha-value>)',
        'gold-text': 'rgb(var(--ef-gold-text-rgb) / <alpha-value>)',
      },
      /*
       * Tailwind's DEFAULTS for a bare `border` / `ring` are gray-200 and
       * blue-500 — stock palette colours that reach the app through the config
       * rather than through a class, so the brand guard cannot see them and
       * `@apply border` in globals.css silently paints a grey the ink ramp
       * never chose. Pointing the defaults at tokens closes that back door:
       * `border` is now the ink hairline and a focus ring is brand red.
       */
      borderColor: {
        DEFAULT: 'rgb(var(--ef-ink-100-rgb) / <alpha-value>)',
      },
      divideColor: {
        DEFAULT: 'rgb(var(--ef-ink-100-rgb) / <alpha-value>)',
      },
      ringColor: {
        DEFAULT: 'rgb(var(--ef-red-500-rgb) / <alpha-value>)',
      },
      fontFamily: {
        // The identity document's faces. The CSS variables are set on <html>
        // by src/app/layout.tsx; the literal names are the fallback for any
        // surface rendered before next/font resolves.
        sans: ['var(--font-plex-sans)', 'IBM Plex Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
