import { describe, expect, it } from 'vitest';
import { createBox } from '../src/model/box.js';
import { toMm } from '../src/model/units.js';

const byName = (pieces) => Object.fromEntries(pieces.map((piece) => [piece.name, piece]));

describe('createBox', () => {
    const t = toMm(0.75, 'in');
    const size = toMm(24, 'in');

    it('is open-topped by default', () => {
        const pieces = createBox({ width: size, height: size, depth: size, thickness: t });
        expect(pieces.map((p) => p.name)).toEqual(['Front', 'Back', 'Left side', 'Right side', 'Bottom']);
    });

    it('adds a top when closed', () => {
        const pieces = createBox({ width: size, height: size, depth: size, thickness: t, closed: true });
        const top = byName(pieces).Top;
        expect(pieces).toHaveLength(6);
        expect(top.position.y).toBeCloseTo(size - t);
        expect(top.height).toBe(t);
    });

    it('fits the sides and bottom between the walls', () => {
        const pieces = byName(createBox({ width: size, height: size, depth: size, thickness: t }));
        const inner = toMm(22.5, 'in');
        expect(pieces.Front).toMatchObject({ width: size, height: size, depth: t });
        expect(pieces['Left side'].depth).toBeCloseTo(inner);
        expect(pieces.Bottom.width).toBeCloseTo(inner);
        expect(pieces.Bottom.depth).toBeCloseTo(inner);
        expect(pieces['Right side'].position.x).toBeCloseTo(size - t);
        expect(pieces.Front.position.z).toBeCloseTo(size - t);
        expect(pieces.Back.position.z).toBe(0);
    });

    it('adds up to the outer dimensions', () => {
        const width = 600, height = 400, depth = 300, thickness = 18;
        const pieces = createBox({ width, height, depth, thickness, closed: true });
        const max = (axis, dim) => Math.max(...pieces.map((p) => p.position[axis] + p[dim]));
        const min = (axis) => Math.min(...pieces.map((p) => p.position[axis]));
        expect([min('x'), min('y'), min('z')]).toEqual([0, 0, 0]);
        expect([max('x', 'width'), max('y', 'height'), max('z', 'depth')]).toEqual([width, height, depth]);
    });

    it('offsets every piece by the origin', () => {
        const pieces = createBox({ width: 600, height: 400, depth: 300, thickness: 18, origin: { x: 1000 } });
        expect(byName(pieces).Back.position).toEqual({ x: 1000, y: 0, z: 0 });
        expect(byName(pieces).Bottom.position).toEqual({ x: 1018, y: 0, z: 18 });
    });

    it('rejects sizes that cannot hold the thickness', () => {
        expect(() => createBox({ width: 30, height: 100, depth: 100, thickness: 18 })).toThrow('twice the thickness');
        expect(() => createBox({ width: 100, height: 30, depth: 100, thickness: 18, closed: true })).toThrow('Height');
        expect(() => createBox({ width: 100, height: 100, depth: 100, thickness: 0 })).toThrow('Thickness');
    });
});
