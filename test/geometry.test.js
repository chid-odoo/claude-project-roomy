import { describe, expect, it } from 'vitest';
import {
    centroid, normalizeAngle, pieceCorners, pieceToWorld, quaternionOf, rotatePiecesAbout, rotationOf,
} from '../src/model/geometry.js';

const board = (rotation = { x: 0, y: 0, z: 0 }) => ({
    width: 600, height: 400, depth: 18, position: { x: 0, y: 0, z: 0 }, rotation,
});

// Same orientation, however the Euler angles are written.
function expectSameRotation(a, b) {
    expect(quaternionOf(a).angleTo(quaternionOf(b))).toBeCloseTo(0, 6);
}

function expectPoint(actual, expected) {
    for (const axis of ['x', 'y', 'z']) {
        expect(actual[axis]).toBeCloseTo(expected[axis], 6);
    }
}

describe('normalizeAngle', () => {
    it('wraps into (-180, 180]', () => {
        expect(normalizeAngle(0)).toBe(0);
        expect(normalizeAngle(270)).toBe(-90);
        expect(normalizeAngle(-270)).toBe(90);
        expect(normalizeAngle(180)).toBe(180);
        expect(normalizeAngle(-180)).toBe(180);
        expect(normalizeAngle(725)).toBe(5);
    });
});

describe('rotationOf', () => {
    it('round-trips through quaternions and cleans float noise', () => {
        expect(rotationOf(quaternionOf({ x: 0, y: 90, z: 0 }))).toEqual({ x: 0, y: 90, z: 0 });
        expect(rotationOf(quaternionOf({ x: 30, y: -45, z: 10 }))).toEqual({ x: 30, y: -45, z: 10 });
    });
});

describe('pieceCorners', () => {
    it('returns the box corners when not rotated', () => {
        const xs = new Set(pieceCorners(board()).map((c) => c.x));
        expect([...xs].sort((a, b) => a - b)).toEqual([0, 600]);
    });

    it('turns the corners about the centre', () => {
        // 600 wide x 18 deep, turned a quarter around Y: now 18 wide x 600 deep,
        // still centred on (300, 200, 9).
        const corners = pieceCorners(board({ x: 0, y: 90, z: 0 }));
        const range = (axis) => [Math.min(...corners.map((c) => c[axis])), Math.max(...corners.map((c) => c[axis]))];
        expect(range('x')[0]).toBeCloseTo(291);
        expect(range('x')[1]).toBeCloseTo(309);
        expect(range('z')[0]).toBeCloseTo(-291);
        expect(range('z')[1]).toBeCloseTo(309);
        expect(range('y')).toEqual([0, 400]);
    });
});

describe('pieceToWorld', () => {
    it('maps the centre to itself whatever the rotation', () => {
        expectPoint(pieceToWorld(board({ x: 20, y: 70, z: -30 }), { x: 300, y: 200, z: 9 }), { x: 300, y: 200, z: 9 });
    });
});

describe('rotatePiecesAbout', () => {
    it('swings piece centres round the pivot and turns each piece', () => {
        const a = { ...board(), position: { x: 0, y: 0, z: 0 } };
        const b = { ...board(), position: { x: 1000, y: 0, z: 0 } };
        const pivot = centroid([a, b]); // (800, 200, 9)
        rotatePiecesAbout([a, b], quaternionOf({ x: 0, y: 90, z: 0 }), pivot);
        // Centres were 500 either side of the pivot along X; now along Z.
        expectPoint({ x: a.position.x + 300, y: a.position.y + 200, z: a.position.z + 9 }, { x: 800, y: 200, z: 509 });
        expectPoint({ x: b.position.x + 300, y: b.position.y + 200, z: b.position.z + 9 }, { x: 800, y: 200, z: -491 });
        expect(a.rotation).toEqual({ x: 0, y: 90, z: 0 });
        expect(b.rotation).toEqual({ x: 0, y: 90, z: 0 });
    });

    it('adds to a piece\'s existing rotation', () => {
        const piece = board({ x: 0, y: 90, z: 0 });
        rotatePiecesAbout([piece], quaternionOf({ x: 0, y: 45, z: 0 }), centroid([piece]));
        expectSameRotation(piece.rotation, { x: 0, y: 135, z: 0 });
    });

    it('keeps the centroid fixed', () => {
        const pieces = [board(), { ...board(), position: { x: 100, y: 300, z: -50 } }];
        const before = centroid(pieces);
        rotatePiecesAbout(pieces, quaternionOf({ x: 33, y: -12, z: 71 }), before);
        expectPoint(centroid(pieces), before);
    });
});
