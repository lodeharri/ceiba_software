import { createI18n } from 'vue-i18n';
import esCO from './es-CO.json';
import en from './en.json';

/**
 * i18n setup — MercadoExpress SPA.
 * Spanish (es-CO) is the primary locale; English is the fallback for missing keys.
 * All UI strings live in these JSON files (design.md §7.7).
 */
export const i18n = createI18n({
  legacy: false, // Composition API mode
  locale: 'es-CO',
  fallbackLocale: 'en',
  messages: {
    'es-CO': esCO,
    en,
  },
  // Warn in development when a key is missing (helps catch untranslated strings)
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
});
