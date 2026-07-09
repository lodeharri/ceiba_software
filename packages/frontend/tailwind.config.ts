import type { Config } from 'tailwindcss';

/**
 * Tailwind tokens. The visual direction (oklch CSS variables, spacing scale,
 * component radii) is added in PR 3 per design.md §8. PR 0 only wires the
 * config so `pnpm --filter frontend build` resolves.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{vue,ts,tsx,js,jsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;