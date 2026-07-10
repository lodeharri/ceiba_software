import type { Config } from 'tailwindcss';

/**
 * Tailwind config — MercadoExpress SPA.
 * All design tokens are CSS variables consumed from tokens.css (design.md §8.2).
 * No raw hex values anywhere in this file.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{vue,ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
        },
        surface: 'var(--color-surface)',
        card: 'var(--color-card)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
        muted: 'var(--color-muted)',
        text: {
          DEFAULT: 'var(--color-text)',
          muted: 'var(--color-text-muted)',
        },
      },
      borderRadius: {
        atom: 'var(--radius-atom)',
        card: 'var(--radius-card)',
        modal: 'var(--radius-modal)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        lg: 'var(--shadow-lg)',
      },
      transitionDuration: {
        hover: 'var(--duration-hover)',
        state: 'var(--duration-state)',
        layout: 'var(--duration-layout)',
      },
      transitionTimingFunction: {
        layout: 'var(--ease-layout)',
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }], // 12px
        sm: ['0.875rem', { lineHeight: '1.25rem' }], // 14px (base)
        base: ['1rem', { lineHeight: '1.5rem' }], // 16px
        lg: ['1.125rem', { lineHeight: '1.75rem' }], // 18px
        xl: ['1.375rem', { lineHeight: '2rem' }], // 22px
        '2xl': ['1.75rem', { lineHeight: '2.25rem' }], // 28px
        '3xl': ['2.25rem', { lineHeight: '2.5rem' }], // 36px
      },
      fontWeight: {
        regular: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
      },
      spacing: {
        1: 'var(--space-1)', // 4px
        2: 'var(--space-2)', // 8px
        3: 'var(--space-3)', // 12px
        4: 'var(--space-4)', // 16px
        6: 'var(--space-6)', // 24px
        8: 'var(--space-8)', // 32px
        12: 'var(--space-12)', // 48px
      },
    },
  },
  plugins: [],
};

export default config;
