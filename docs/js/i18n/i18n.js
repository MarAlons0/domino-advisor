/**
 * i18n - Internationalization engine for 7 Fichas
 *
 * Usage:
 * - Import { t, i18n } from './i18n/i18n.js'
 * - Use t('key') for translations
 * - Use t('key', arg1, arg2) for translations with placeholders
 * - Use i18n.setLanguage('es') to switch languages
 * - Add data-i18n="key" to HTML elements for automatic updates
 */

import { translations } from './translations.js';

const STORAGE_KEY = '7fichas_language';
const DEFAULT_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = ['en', 'es'];

class I18n {
    constructor() {
        this.currentLanguage = DEFAULT_LANGUAGE;
        this.listeners = [];
        this._initialized = false;
    }

    /**
     * Initialize the i18n system
     * Should be called once when the app loads
     */
    init() {
        if (this._initialized) return;

        // Try to load saved preference
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && SUPPORTED_LANGUAGES.includes(saved)) {
            this.currentLanguage = saved;
        } else {
            // Detect browser language
            const browserLang = navigator.language?.split('-')[0];
            if (browserLang && SUPPORTED_LANGUAGES.includes(browserLang)) {
                this.currentLanguage = browserLang;
            }
        }

        this._initialized = true;
    }

    /**
     * Get a translation by key
     * @param {string} key - Translation key (e.g., 'app.title')
     * @param {...any} args - Placeholder values for {0}, {1}, etc.
     * @returns {string} Translated string
     */
    t(key, ...args) {
        const lang = this.currentLanguage;
        const langStrings = translations[lang] || translations[DEFAULT_LANGUAGE];
        let text = langStrings[key];

        // Fall back to default language if key not found
        if (text === undefined) {
            text = translations[DEFAULT_LANGUAGE]?.[key];
        }

        // Fall back to the key itself if still not found
        if (text === undefined) {
            console.warn(`Missing translation: ${key}`);
            return key;
        }

        // Replace placeholders {0}, {1}, etc.
        if (args.length > 0) {
            args.forEach((arg, index) => {
                text = text.replace(new RegExp(`\\{${index}\\}`, 'g'), arg);
            });
        }

        return text;
    }

    /**
     * Set the current language
     * @param {string} lang - Language code ('en' or 'es')
     */
    setLanguage(lang) {
        if (!SUPPORTED_LANGUAGES.includes(lang)) {
            console.warn(`Unsupported language: ${lang}`);
            return;
        }

        if (this.currentLanguage === lang) return;

        this.currentLanguage = lang;
        localStorage.setItem(STORAGE_KEY, lang);

        // Update all DOM elements with data-i18n attributes
        this.updateDOM();

        // Notify listeners
        this.listeners.forEach(callback => {
            try {
                callback(lang);
            } catch (e) {
                console.error('Error in language change listener:', e);
            }
        });
    }

    /**
     * Get the current language
     * @returns {string} Current language code
     */
    getLanguage() {
        return this.currentLanguage;
    }

    /**
     * Update all DOM elements with data-i18n attributes
     */
    updateDOM() {
        // Update text content
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const text = this.t(key);

            // Check if element has HTML content markers
            if (el.hasAttribute('data-i18n-html')) {
                el.innerHTML = text;
            } else {
                el.textContent = text;
            }
        });

        // Update placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = this.t(key);
        });

        // Update titles (tooltips)
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = this.t(key);
        });

        // Update the document language attribute
        document.documentElement.lang = this.currentLanguage;
    }

    /**
     * Register a callback for language changes
     * @param {function} callback - Function called with new language code
     * @returns {function} Unsubscribe function
     */
    onLanguageChange(callback) {
        this.listeners.push(callback);

        // Return unsubscribe function
        return () => {
            const index = this.listeners.indexOf(callback);
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        };
    }

    /**
     * Toggle between English and Spanish
     */
    toggleLanguage() {
        const newLang = this.currentLanguage === 'en' ? 'es' : 'en';
        this.setLanguage(newLang);
    }

    /**
     * Get list of supported languages
     * @returns {string[]}
     */
    getSupportedLanguages() {
        return [...SUPPORTED_LANGUAGES];
    }
}

// Create singleton instance
export const i18n = new I18n();

// Export convenience function
export function t(key, ...args) {
    return i18n.t(key, ...args);
}

// Initialize on module load
i18n.init();
