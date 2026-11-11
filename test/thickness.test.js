import { describe, expect, it } from 'vitest';
import { createBox } from '../src/model/box.js';
import { bounds, pieceCorners } from '../src/model/geometry.js';
import { Project } from '../src/model/project.js';
import { thicknessOf } from '../src/model/thickness.js';

const THREE_QUARTER = 19.05;
const HALF = 12.7;
const size = { width: 600, height: 300, depth: 400 };

// A project holding one box (grouped, as the app makes them), optionally
// turned as a whole.
function boxProject(thickness, { closed = false, rotation } = {}) {
    const project = new Project();
    const group = project.addBox(createBox({ ...size, thickness, closed }));
    if (rotation) {
        project.rotateGroup(group.id, rotation);
    }
    project.clearHistory();
    return project;
}

const allIds = (project) => project.pieces.map((p) => p.id);

// Same corners, piece by piece (matched by name).
function expectSameBoards(actual, expected) {
    expect(actual.pieces.map((p) => p.name)).toEqual(expected.pieces.map((p) => p.name));
    actual.pieces.forEach((piece, i) => {
        const want = pieceCorners(expected.pieces[i]);
        pieceCorners(piece).forEach((corner, j) => {
            for (const axis of ['x', 'y', 'z']) {
                expect(corner[axis], `${piece.name} corner ${j} ${axis}`).toBeCloseTo(want[j][axis], 6);
            }
        });
    });
}

describe('thicknessOf', () => {
    it('is the smallest dimension, whichever axis it is on', () => {
        expect(thicknessOf({ width: 18, height: 400, depth: 600 })).toBe(18);
        expect(thicknessOf({ width: 600, height: 18, depth: 400 })).toBe(18);
        expect(thicknessOf({ width: 600, height: 400, depth: 18 })).toBe(18);
    });
});

describe('setThickness', () => {
    it('rebuilds a box at the new thickness with the same outside size', () => {
        const project = boxProject(THREE_QUARTER);
        project.setThickness(allIds(project), HALF);
        expectSameBoards(project, boxProject(HALF));
    });

    it('works on a closed box and when getting thicker', () => {
        const project = boxProject(HALF, { closed: true });
        project.setThickness(allIds(project), THREE_QUARTER);
        expectSameBoards(project, boxProject(THREE_QUARTER, { closed: true }));
    });

    it('works on a rotated box', () => {
        const rotation = { x: 90, z: 30 };
        const project = boxProject(THREE_QUARTER, { rotation });
        const outside = bounds(project.pieces);
        project.setThickness(allIds(project), HALF);
        for (const end of ['min', 'max']) {
            for (const axis of ['x', 'y', 'z']) {
                expect(bounds(project.pieces)[end][axis]).toBeCloseTo(outside[end][axis], 6);
            }
        }
        // A box rotated about its piece centres sits slightly differently at
        // another thickness, so line the expected one up by its outside.
        const expected = boxProject(HALF, { rotation });
        const shift = bounds(expected.pieces).min;
        for (const piece of expected.pieces) {
            for (const axis of ['x', 'y', 'z']) {
                piece.position[axis] += outside.min[axis] - shift[axis];
            }
        }
        expectSameBoards(project, expected);
    });

    it('keeps the bottom on the floor when only the bottom changes', () => {
        const project = boxProject(THREE_QUARTER);
        const before = JSON.parse(JSON.stringify(project.pieces));
        const bottom = project.pieces.find((p) => p.name === 'Bottom');
        project.setThickness([bottom.id], HALF);
        expect(bottom.height).toBeCloseTo(HALF);
        expect(bottom.position.y).toBeCloseTo(0);
        project.pieces.filter((p) => p !== bottom).forEach((piece, i) => {
            expect(piece).toEqual(before.filter((p) => p.name !== 'Bottom')[i]);
        });
    });

    it('keeps a loose board\'s face nearest the origin and moves a board lying on it', () => {
        const project = new Project();
        const [shelf, lid] = project.addPieces([
            { width: 600, height: 400, depth: THREE_QUARTER, rotation: { x: 90 } },
            { width: 600, height: 400, depth: THREE_QUARTER, rotation: { x: 90 }, position: { y: THREE_QUARTER } },
        ]);
        const shelfBottom = bounds([shelf]).min.y;
        expect(bounds([lid]).min.y).toBeCloseTo(bounds([shelf]).max.y); // resting on it
        project.setThickness([shelf.id], HALF);
        expect(bounds([shelf]).min.y).toBeCloseTo(shelfBottom);
        expect(bounds([shelf]).max.y).toBeCloseTo(shelfBottom + HALF);
        expect(bounds([lid]).min.y).toBeCloseTo(shelfBottom + HALF);
        expect(thicknessOf(lid)).toBeCloseTo(THREE_QUARTER);
    });

    it('leaves boards that don\'t touch a moved face alone', () => {
        const project = new Project();
        const [a, b] = project.addPieces([
            { width: 600, height: 400, depth: THREE_QUARTER },
            { width: 600, height: 400, depth: THREE_QUARTER, position: { x: 1000 } },
        ]);
        project.setThickness([a.id], HALF);
        expect(b).toMatchObject({ depth: THREE_QUARTER, position: { x: 1000, y: 0, z: 0 } });
    });

    it('is one undo step', () => {
        const project = boxProject(THREE_QUARTER);
        const before = JSON.parse(JSON.stringify(project.pieces));
        project.setThickness(allIds(project), HALF);
        project.undo();
        expect(project.pieces).toEqual(before);
        expect(project.canUndo).toBe(false);
    });

    it('does nothing when the thickness is already right', () => {
        const project = boxProject(THREE_QUARTER);
        project.setThickness(allIds(project), THREE_QUARTER);
        expect(project.canUndo).toBe(false);
    });

    it('rejects bad thicknesses and leaves the design as it was', () => {
        const project = boxProject(THREE_QUARTER);
        const before = JSON.parse(JSON.stringify(project.pieces));
        expect(() => project.setThickness(allIds(project), 0)).toThrow('positive');
        expect(() => project.setThickness(allIds(project), 250)).toThrow('too small for that thickness');
        expect(project.pieces).toEqual(before);
        expect(project.canUndo).toBe(false);
    });
});
