import { describe, expect, it } from 'vitest';
import { bounds, labelAnchors, pieceTransform } from '../src/view/transform.js';

const piece = { width: 600, height: 400, depth: 18, position: { x: 100, y: 0, z: 200 } };

describe('pieceTransform', () => {
    it('scales to metres and centres the box', () => {
        const { scale, center } = pieceTransform(piece);
        expect(scale).toEqual([0.6, 0.4, 0.018]);
        expect(center).toEqual([0.4, 0.2, 0.209]);
    });
});

describe('labelAnchors', () => {
    it('places labels on the middle of the front and left edges', () => {
        const anchors = labelAnchors(piece);
        expect(anchors.width).toEqual([0.4, 0, 0.218]);
        expect(anchors.height).toEqual([0.1, 0.2, 0.218]);
        expect(anchors.depth).toEqual([0.1, 0, 0.209]);
    });

    it('follows the edges of a rotated piece', () => {
        // Quarter turn about Y around the centre (0.4, 0.2, 0.209): the front
        // edge (z = 0.218) swings round to x = 0.409.
        const anchors = labelAnchors({ ...piece, rotation: { x: 0, y: 90, z: 0 } });
        expect(anchors.width[0]).toBeCloseTo(0.409);
        expect(anchors.width[1]).toBeCloseTo(0);
        expect(anchors.width[2]).toBeCloseTo(0.209);
    });
});

describe('pieceTransform rotation', () => {
    it('converts degrees to radians', () => {
        const { rotation } = pieceTransform({ ...piece, rotation: { x: 180, y: -90, z: 0 } });
        expect(rotation[0]).toBeCloseTo(Math.PI);
        expect(rotation[1]).toBeCloseTo(-Math.PI / 2);
        expect(rotation[2]).toBe(0);
    });
});

describe('bounds', () => {
    it('returns null without pieces', () => {
        expect(bounds([])).toBeNull();
    });

    it('includes rotated corners', () => {
        const turned = { ...piece, rotation: { x: 0, y: 90, z: 0 } };
        const box = bounds([turned]);
        expect(box.max.x - box.min.x).toBeCloseTo(18);
        expect(box.max.z - box.min.z).toBeCloseTo(600);
    });

    it('covers every piece', () => {
        const other = { width: 50, height: 900, depth: 50, position: { x: -50, y: 0, z: 0 } };
        expect(bounds([piece, other])).toEqual({
            min: { x: -50, y: 0, z: 0 },
            max: { x: 700, y: 900, z: 218 },
        });
    });
});
