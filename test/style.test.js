import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

// Each { ... } block that declares colour tokens, by its selector.
function tokenBlocks() {
    const blocks = {};
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*--bg:[^{}]*)\}/g)) {
        blocks[selector.trim()] = Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    }
    return blocks;
}

describe('style.css themes', () => {
    it('only uses colours through tokens, so every colour changes with the theme', () => {
        const outside = css.replace(/([^{}]+)\{([^{}]*--bg:[^{}]*)\}/g, '');
        expect(outside.match(COLOUR)).toBeNull();
    });

    it('defines the same tokens for light, dark and the first-paint fallback', () => {
        const blocks = tokenBlocks();
        expect(Object.keys(blocks)).toEqual([':root', ':root[data-theme="dark"]', ':root:not([data-theme])']);
        const [light, dark, fallback] = Object.values(blocks);
        expect(Object.keys(dark)).toEqual(Object.keys(light));
        expect(fallback).toEqual(dark);
    });

    it('defines every custom property it uses', () => {
        // Colour tokens, plus layout ones like --panel-width set elsewhere.
        const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1].slice(2)));
        const used = [...css.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]);
        expect(used.filter((name) => !defined.has(name))).toEqual([]);
    });
});
