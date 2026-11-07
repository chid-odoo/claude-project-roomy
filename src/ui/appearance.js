// Appearance preferences: theme (match device / light / dark) and soft
// shadows. Kept per device in localStorage, not in design files. The
// resolved theme is set as <html data-theme="light|dark">, which the CSS
// colour tokens key off; listeners (the 3D scene) are told about changes.

export const THEMES = { system: 'Match device', light: 'Light', dark: 'Dark' };
const KEY = 'roomy:appearance';
const DARK_QUERY = '(prefers-color-scheme: dark)';
// Browser toolbar colour on phones, matching each theme's background.
const THEME_COLOR = { light: '#8a5a2b', dark: '#1d1a17' };

export function resolveTheme(preference, prefersDark) {
    if (preference === 'light' || preference === 'dark') {
        return preference;
    }
    return prefersDark ? 'dark' : 'light';
}

export class Appearance {
    // `storage` may be null or throw (private mode); `media` is the
    // prefers-color-scheme MediaQueryList, or null where unsupported.
    constructor({ storage = null, media = null, root = document.documentElement } = {}) {
        this.storage = storage;
        this.media = media;
        this.root = root;
        this.listeners = new Set();
        const saved = this._read();
        this.theme = Object.hasOwn(THEMES, saved.theme) ? saved.theme : 'system';
        this.shadows = typeof saved.shadows === 'boolean' ? saved.shadows : true;
        if (media) {
            media.addEventListener('change', () => {
                if (this.theme === 'system') {
                    this._apply();
                }
            });
        }
        this._apply();
    }

    static forWindow() {
        let storage = null;
        try {
            storage = window.localStorage;
        } catch {
            // Storage blocked: preferences last until the page closes.
        }
        return new Appearance({ storage, media: window.matchMedia ? window.matchMedia(DARK_QUERY) : null });
    }

    // The theme actually shown: 'light' or 'dark'.
    get resolved() {
        return resolveTheme(this.theme, Boolean(this.media && this.media.matches));
    }

    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    setTheme(theme) {
        if (!Object.hasOwn(THEMES, theme)) {
            throw new Error(`Unknown theme: ${theme}`);
        }
        this.theme = theme;
        this._save();
        this._apply();
    }

    setShadows(on) {
        this.shadows = Boolean(on);
        this._save();
        this._notify();
    }

    _apply() {
        const resolved = this.resolved;
        this.root.dataset.theme = resolved;
        const meta = this.root.ownerDocument && this.root.ownerDocument.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute('content', THEME_COLOR[resolved]);
        }
        this._notify();
    }

    _notify() {
        for (const listener of this.listeners) {
            listener(this);
        }
    }

    _read() {
        try {
            return JSON.parse(this.storage.getItem(KEY)) || {};
        } catch {
            return {};
        }
    }

    _save() {
        try {
            this.storage.setItem(KEY, JSON.stringify({ theme: this.theme, shadows: this.shadows }));
        } catch {
            // Not saved; the choice still applies for now.
        }
    }
}
