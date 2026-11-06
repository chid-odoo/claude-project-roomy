import { describe, expect, it } from 'vitest';
import { createBox } from '../src/model/box.js';
import { buildCutList } from '../src/model/cutlist.js';

describe('buildCutList', () => {
    it('orders each piece as thickness, length, width whatever its orientation', () => {
        const rows = buildCutList([{ name: 'Side', width: 18, height: 400, depth: 300 }]);
        expect(rows).toEqual([{ thickness: 18, length: 400, width: 300, quantity: 1, names: ['Side'] }]);
    });

    it('groups identical pieces', () => {
        const rows = buildCutList(createBox({ width: 600, height: 400, depth: 300, thickness: 18, closed: true }));
        expect(rows).toEqual([
            { thickness: 18, length: 600, width: 400, quantity: 2, names: ['Front', 'Back'] },
            { thickness: 18, length: 564, width: 264, quantity: 2, names: ['Bottom', 'Top'] },
            { thickness: 18, length: 400, width: 264, quantity: 2, names: ['Left side', 'Right side'] },
        ]);
    });

    it('sorts thinner stock first', () => {
        const rows = buildCutList([
            { name: 'Panel', width: 600, height: 18, depth: 300 },
            { name: 'Back', width: 600, height: 6, depth: 300 },
        ]);
        expect(rows.map((row) => row.names[0])).toEqual(['Back', 'Panel']);
    });

    it('returns an empty list for no pieces', () => {
        expect(buildCutList([])).toEqual([]);
    });
});
