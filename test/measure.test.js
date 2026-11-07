import { describe, expect, it } from 'vitest';
import { measure, snap, snapTargets } from '../src/view/measure.js';

const board = { width: 600, height: 400, depth: 18, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
// A flat "camera": 1 mm = 1 px looking down -Z, so screen x = x, y = -y.
const flat = (p) => ({ x: p.x, y: -p.y, visible: true });

describe('snapTargets', () => {
    it('lists 8 corners and 12 edges per piece', () => {
        const { points, edges } = snapTargets([board]);
        expect(points.filter((p) => p.kind === 'corner')).toHaveLength(8);
        expect(edges).toHaveLength(12);
        const lengths = edges.map(([a, b]) => Math.round(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z))).sort((a, b) => a - b);
        expect(lengths).toEqual([18, 18, 18, 18, 400, 400, 400, 400, 600, 600, 600, 600]);
    });

    it('follows rotation', () => {
        const turned = { ...board, rotation: { x: 0, y: 90, z: 0 } };
        const xs = snapTargets([turned]).points.map((p) => Math.round(p.point.x));
        expect(Math.min(...xs)).toBe(291);
        expect(Math.max(...xs)).toBe(309);
    });
});

describe('snap', () => {
    const targets = snapTargets([board]);

    it('snaps to a nearby corner', () => {
        const hit = snap({ x: 595, y: -396 }, targets, flat);
        expect(hit.kind).toBe('corner');
        expect([hit.point.x, hit.point.y]).toEqual([600, 400]);
    });

    it('prefers points to edges, then the nearest point on an edge', () => {
        expect(snap({ x: 3, y: -3 }, targets, flat).kind).toBe('corner');
        const hit = snap({ x: 300, y: -5 }, targets, flat);
        expect(hit.kind).toBe('edge');
        expect(hit.point.x).toBeCloseTo(300);
        expect(hit.point.y).toBeCloseTo(0);
    });

    it('gives nothing when far from everything or hidden', () => {
        expect(snap({ x: 300, y: -200 }, targets, flat)).toBeNull();
        expect(snap({ x: 600, y: -400 }, targets, (p) => ({ ...flat(p), visible: false }))).toBeNull();
    });
});

describe('measure', () => {
    it('gives the straight distance and its parts', () => {
        expect(measure({ x: 0, y: 0, z: 0 }, { x: 300, y: -400, z: 0 })).toEqual({ distance: 500, dx: 300, dy: 400, dz: 0 });
    });
});
