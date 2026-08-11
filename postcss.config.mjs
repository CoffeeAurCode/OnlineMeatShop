/**
 * Tailwind v4 wiring.
 *
 * ⚠ v4 does NOT use the `tailwindcss` PostCSS plugin — that is v3, and it fails
 * in ways that look like "Tailwind produced no output" rather than like a
 * misconfiguration. The plugin moved to its own package.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
