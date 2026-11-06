import { describe, expect, it } from 'vitest';
import { createBox } from '../src/model/box.js';
import { DEFAULT_SHEET, estimateSheets, validateSheet } from '../src/model/sheets.js';
import { toMm } from '../src/model/units.js';

const inch = (n) => toMm(n, 'in');
const T = inch(0.75);
let nextId = 1;
// A flat board: `length` x `width` x 3/4" (or `thickness`).
const board = (length, width, name = `P${nextId}`, thickness = T) => (
    { id: nextId++, name, width: length, height: thickness, depth: width }
);
const sheet = (changes = {}) => ({ ...DEFAULT_SHEET, ...changes });

// Every placement inside the sheet, no two overlapping, kerf kept between.
function expectValidLayout(result, options = DEFAULT_SHEET) {
    for (const group of result) {
        for (const { placements } of group.sheets) {
            for (const p of placements) {
                expect(p.x).toBeGreaterThanOrEqual(-1e-6);
                expect(p.y).toBeGreaterThanOrEqual(-1e-6);
                expect(p.x + p.w).toBeLessThanOrEqual(options.length + 1e-6);
                expect(p.y + p.h).toBeLessThanOrEqual(options.width + 1e-6);
            }
            placements.forEach((a, i) => placements.slice(i + 1).forEach((b) => {
                const apart = a.x + a.w + options.kerf <= b.x + 1e-6 || b.x + b.w + options.kerf <= a.x + 1e-6
                    || a.y + a.h + options.kerf <= b.y + 1e-6 || b.y + b.h + options.kerf <= a.y + 1e-6;
                expect(apart, `${a.name} and ${b.name} overlap`).toBe(true);
            }));
        }
    }
}

describe('estimateSheets', () => {
    it('fits four 2\' x 4\' pieces exactly on one 4\' x 8\' sheet with no kerf', () => {
        const pieces = [1, 2, 3, 4].map(() => board(inch(48), inch(24)));
        const [group] = estimateSheets(pieces, sheet({ kerf: 0 }));
        expect(group.sheets).toHaveLength(1);
        expect(group.used).toBeCloseTo(1);
        expectValidLayout([group], sheet({ kerf: 0 }));
    });

    it('needs a second sheet once the saw kerf is counted', () => {
        const pieces = [1, 2, 3, 4].map(() => board(inch(48), inch(24)));
        const result = estimateSheets(pieces);
        expect(result[0].sheets).toHaveLength(2);
        expectValidLayout(result);
    });

    it('keeps the kerf between pieces but not at the sheet edge', () => {
        const pieces = [board(inch(48), inch(24)), board(inch(48), inch(24) - DEFAULT_SHEET.kerf)];
        const result = estimateSheets(pieces);
        expect(result[0].sheets).toHaveLength(1);
        expectValidLayout(result);
    });

    it('turns pieces to fit when rotation is allowed, and not otherwise', () => {
        // 47" x 30": along the grain only two fit (2 x 47 = 94 of 96, and
        // 30 + 30 > 48 across). Turned, three fit (3 x 30 = 90 along, 47 across).
        const pieces = [1, 2, 3].map(() => board(inch(47), inch(30)));
        const free = estimateSheets(pieces);
        expect(free[0].sheets).toHaveLength(1);
        expect(free[0].sheets[0].placements.every((p) => p.rotated)).toBe(true);
        expectValidLayout(free);

        const locked = estimateSheets(pieces, sheet({ allowRotate: false }));
        expect(locked[0].sheets).toHaveLength(2);
        expect(locked[0].sheets.flatMap((s) => s.placements).some((p) => p.rotated)).toBe(false);
        expectValidLayout(locked, sheet({ allowRotate: false }));
    });

    it('lays a piece longer than the sheet is wide along the grain', () => {
        const [group] = estimateSheets([board(inch(90), inch(10))], sheet({ allowRotate: false }));
        expect(group.sheets[0].placements[0]).toMatchObject({ x: 0, y: 0, rotated: false });
    });

    it('reports pieces too big for the sheet instead of placing them', () => {
        const [group] = estimateSheets([board(inch(100), inch(10), 'Long'), board(inch(10), inch(10))]);
        expect(group.oversized.map((p) => p.name)).toEqual(['Long']);
        expect(group.sheets).toHaveLength(1);
    });

    it('treats pieces too long across but fine along the sheet as fitting only if they can lie along it', () => {
        // 60" x 40": along the 96" length it fits; it can never stand across (48").
        const [group] = estimateSheets([board(inch(60), inch(40))], sheet({ allowRotate: false }));
        expect(group.oversized).toEqual([]);
    });

    it('packs each thickness on its own sheets, thinnest first', () => {
        const pieces = [board(inch(20), inch(20), 'Thick'), board(inch(20), inch(20), 'Thin', inch(0.25))];
        const result = estimateSheets(pieces);
        expect(result.map((g) => g.thickness)).toEqual([inch(0.25), T]);
        expect(result.map((g) => g.sheets[0].placements[0].name)).toEqual(['Thin', 'Thick']);
    });

    it('works whatever way round the piece is modelled', () => {
        const upright = { id: 99, name: 'Side', width: T, height: inch(30), depth: inch(12) };
        const [group] = estimateSheets([upright]);
        expect(group.thickness).toBeCloseTo(T);
        const { w, h } = group.sheets[0].placements[0];
        expect([w, h].sort((a, b) => a - b)).toEqual([inch(12), inch(30)]);
    });

    it('lays out a real box on one sheet with every piece placed', () => {
        const pieces = createBox({ width: inch(24), height: inch(12), depth: inch(16), thickness: T, closed: true })
            .map((p, i) => ({ ...p, id: i + 1 }));
        const result = estimateSheets(pieces);
        expect(result[0].sheets).toHaveLength(1);
        expect(result[0].sheets[0].placements).toHaveLength(6);
        expect(result[0].used).toBeGreaterThan(0.1);
        expectValidLayout(result);
    });

    it('stays valid for many mixed pieces', () => {
        const sizes = [[30, 20], [12, 11], [45, 23], [8, 6], [60, 15], [22, 22], [33, 4], [70, 30], [16, 9], [40, 40]];
        const pieces = [...sizes, ...sizes].map(([l, w]) => board(inch(l), inch(w)));
        const result = estimateSheets(pieces);
        const placed = result[0].sheets.flatMap((s) => s.placements).length;
        expect(placed).toBe(pieces.length);
        const area = pieces.reduce((sum, p) => sum + p.width * p.depth, 0);
        const minSheets = Math.ceil(area / (DEFAULT_SHEET.length * DEFAULT_SHEET.width));
        expect(result[0].sheets.length).toBeGreaterThanOrEqual(minSheets);
        expect(result[0].sheets.length).toBeLessThanOrEqual(minSheets + 1);
        expectValidLayout(result);
    });

    it('returns nothing for no pieces', () => {
        expect(estimateSheets([])).toEqual([]);
    });
});

describe('validateSheet', () => {
    it('accepts the default and rejects bad values', () => {
        expect(() => validateSheet(DEFAULT_SHEET)).not.toThrow();
        expect(() => validateSheet(sheet({ length: 0 }))).toThrow('Sheet length');
        expect(() => validateSheet(sheet({ width: NaN }))).toThrow('Sheet width');
        expect(() => validateSheet(sheet({ kerf: -1 }))).toThrow('kerf');
        expect(() => validateSheet(sheet({ allowRotate: 'yes' }))).toThrow('rotating');
        expect(() => validateSheet(sheet({ kerf: 0 }))).not.toThrow();
    });
});
