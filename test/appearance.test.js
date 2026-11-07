// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Appearance, resolveTheme } from '../src/ui/appearance.js';

class MemoryStorage {
    constructor(items = {}) {
        this.items = new Map(Object.entries(items));
    }

    getItem(key) {
        return this.items.has(key) ? this.items.get(key) : null;
    }

    setItem(key, value) {
        this.items.set(key, String(value));
    }
}

// A prefers-color-scheme query we can flip.
function media(matches) {
    const listeners = [];
    return {
        matches,
        addEventListener: (type, fn) => listeners.push(fn),
        set(value) {
            this.matches = value;
            listeners.forEach((fn) => fn());
        },
    };
}

function setup({ storage = new MemoryStorage(), dark = false } = {}) {
    document.head.innerHTML = '<meta name="theme-color" content="#8a5a2b">';
    const query = media(dark);
    const appearance = new Appearance({ storage, media: query });
    return { appearance, query, storage };
}

const shown = () => document.documentElement.dataset.theme;

describe('resolveTheme', () => {
    it('follows the device unless light or dark is chosen', () => {
        expect(resolveTheme('system', true)).toBe('dark');
        expect(resolveTheme('system', false)).toBe('light');
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
    });
});

describe('Appearance', () => {
    it('matches the device by default, with shadows on', () => {
        const { appearance } = setup({ dark: true });
        expect(appearance.theme).toBe('system');
        expect(appearance.shadows).toBe(true);
        expect(shown()).toBe('dark');
        expect(document.querySelector('meta[name="theme-color"]').content).toBe('#1d1a17');
    });

    it('follows the device changing while on "Match device" only', () => {
        const { appearance, query } = setup({ dark: false });
        const listener = vi.fn();
        appearance.onChange(listener);
        query.set(true);
        expect(shown()).toBe('dark');
        expect(listener).toHaveBeenCalledTimes(1);
        appearance.setTheme('light');
        query.set(false);
        query.set(true);
        expect(shown()).toBe('light');
        expect(listener).toHaveBeenCalledTimes(2); // only the setTheme
    });

    it('remembers the theme and shadows on this device', () => {
        const storage = new MemoryStorage();
        const first = setup({ storage }).appearance;
        first.setTheme('dark');
        first.setShadows(false);
        const again = setup({ storage, dark: false }).appearance;
        expect(again.theme).toBe('dark');
        expect(again.shadows).toBe(false);
        expect(shown()).toBe('dark');
    });

    it('notifies listeners of shadow changes', () => {
        const { appearance } = setup();
        const listener = vi.fn();
        appearance.onChange(listener);
        appearance.setShadows(false);
        expect(listener).toHaveBeenCalledWith(appearance);
    });

    it('copes with missing, broken or blocked storage', () => {
        expect(setup({ storage: null }).appearance.theme).toBe('system');
        const broken = new MemoryStorage({ 'roomy:appearance': '{nope' });
        expect(setup({ storage: broken }).appearance.shadows).toBe(true);
        const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
        const { appearance } = setup({ storage: blocked });
        expect(() => appearance.setTheme('dark')).not.toThrow();
        expect(shown()).toBe('dark');
    });

    it('ignores unknown saved themes and rejects unknown new ones', () => {
        const storage = new MemoryStorage({ 'roomy:appearance': '{"theme":"neon"}' });
        const { appearance } = setup({ storage });
        expect(appearance.theme).toBe('system');
        expect(() => appearance.setTheme('neon')).toThrow('Unknown theme');
    });

    it('works without media query support', () => {
        document.documentElement.dataset.theme = '';
        const appearance = new Appearance({ storage: null, media: null });
        expect(appearance.resolved).toBe('light');
        expect(shown()).toBe('light');
    });
});
