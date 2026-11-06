import { describe, expect, it, vi } from 'vitest';
import { bounds } from '../src/model/geometry.js';
import { groupKey, HISTORY_LIMIT, pieceKey, Project } from '../src/model/project.js';

const panel = { width: 600, height: 400, depth: 18 };

// Project with `n` pieces at x = 0, 100, 200...
function projectWith(n) {
    const project = new Project();
    project.addPieces(Array.from({ length: n }, (_, i) => ({ ...panel, position: { x: i * 100 } })));
    project.clearHistory();
    return project;
}

describe('pieces', () => {
    it('adds pieces with ids, default names and positions', () => {
        const project = new Project();
        const [a, b] = project.addPieces([panel, { ...panel, name: 'Shelf', position: { y: 200 } }]);
        expect(a).toMatchObject({ id: 1, name: 'Piece 1', groupId: null, position: { x: 0, y: 0, z: 0 } });
        expect(b).toMatchObject({ id: 2, name: 'Shelf', position: { x: 0, y: 200, z: 0 } });
    });

    it('updates dimensions and merges partial positions', () => {
        const project = new Project();
        const piece = project.addPiece({ ...panel, position: { x: 10, y: 20, z: 30 } });
        project.updatePiece(piece.id, { width: 500, position: { y: 50 } });
        expect(project.getPiece(piece.id)).toMatchObject({ width: 500, height: 400, position: { x: 10, y: 50, z: 30 } });
    });

    it('rejects invalid dimensions and leaves the piece unchanged', () => {
        const project = new Project();
        const piece = project.addPiece(panel);
        expect(() => project.updatePiece(piece.id, { width: 0 })).toThrow('width');
        expect(() => project.updatePiece(piece.id, { height: NaN })).toThrow('height');
        expect(() => project.updatePiece(piece.id, { position: { x: NaN } })).toThrow('position x');
        expect(() => project.addPiece({ ...panel, depth: -1 })).toThrow('depth');
        expect(project.getPiece(piece.id).width).toBe(600);
    });

    it('notifies listeners on every change until unsubscribed', () => {
        const project = new Project();
        const listener = vi.fn();
        const off = project.onChange(listener);
        const piece = project.addPiece(panel);
        project.updatePiece(piece.id, { name: 'Side' });
        project.setUnit('mm');
        expect(listener).toHaveBeenCalledTimes(3);
        off();
        project.select([pieceKey(piece.id)]);
        expect(listener).toHaveBeenCalledTimes(3);
    });
});

describe('selection', () => {
    it('selects, toggles and clears', () => {
        const project = projectWith(3);
        project.select([pieceKey(1)]);
        project.toggle(pieceKey(2));
        expect(project.selection).toEqual(['piece:1', 'piece:2']);
        project.toggle(pieceKey(1));
        expect(project.selection).toEqual(['piece:2']);
        project.clearSelection();
        expect(project.selection).toEqual([]);
    });

    it('ignores unknown and duplicate keys', () => {
        const project = projectWith(1);
        project.select([pieceKey(1), pieceKey(1), pieceKey(42), groupKey(7)]);
        expect(project.selection).toEqual(['piece:1']);
        project.toggle(pieceKey(42));
        expect(project.selection).toEqual(['piece:1']);
    });

    it('exposes a single selected piece or group for editing', () => {
        const project = projectWith(2);
        project.select([pieceKey(1)]);
        expect(project.selectedPiece.id).toBe(1);
        expect(project.selectedGroup).toBeNull();
        const group = project.group([pieceKey(1), pieceKey(2)]);
        expect(project.selectedGroup).toBe(group);
        expect(project.selectedPiece).toBeNull();
    });

    it('lists selected pieces once even when a group and its piece are both selected', () => {
        const project = projectWith(3);
        const group = project.group([pieceKey(1), pieceKey(2)]);
        project.select([groupKey(group.id), pieceKey(1), pieceKey(3)]);
        expect(project.selectedPieces.map((p) => p.id)).toEqual([1, 2, 3]);
    });
});

describe('moveSelection', () => {
    it('moves every selected piece, including those inside groups', () => {
        const project = projectWith(3);
        project.group([pieceKey(1), pieceKey(2)]);
        project.toggle(pieceKey(3));
        project.moveSelection({ x: 10, y: -5 });
        expect(project.pieces.map((p) => p.position)).toEqual([
            { x: 10, y: -5, z: 0 },
            { x: 110, y: -5, z: 0 },
            { x: 210, y: -5, z: 0 },
        ]);
    });

    it('leaves unselected pieces alone', () => {
        const project = projectWith(2);
        project.select([pieceKey(2)]);
        project.moveSelection({ z: 25 });
        expect(project.getPiece(1).position.z).toBe(0);
        expect(project.getPiece(2).position.z).toBe(25);
    });
});

describe('group', () => {
    it('names groups Group 1, Group 2... and never reuses a number', () => {
        const project = projectWith(4);
        const a = project.group([pieceKey(1), pieceKey(2)]);
        const b = project.group([pieceKey(3), pieceKey(4)]);
        expect([a.name, b.name]).toEqual(['Group 1', 'Group 2']);
        project.ungroup([groupKey(a.id)]);
        const c = project.group([pieceKey(1), pieceKey(2)]);
        expect(c.name).toBe('Group 3');
    });

    it('groups the selection by default and selects the new group', () => {
        const project = projectWith(2);
        project.select([pieceKey(1), pieceKey(2)]);
        const group = project.group();
        expect(project.selection).toEqual([groupKey(group.id)]);
        expect(project.pieces.every((p) => p.groupId === group.id)).toBe(true);
    });

    it('nests groups inside groups', () => {
        const project = projectWith(4);
        const lid = project.group([pieceKey(1), pieceKey(2)]);
        const box = project.group([groupKey(lid.id), pieceKey(3), pieceKey(4)]);
        expect(lid.parentId).toBe(box.id);
        expect(project.childrenOf(null)).toEqual([groupKey(box.id)]);
        expect(project.topLevelKey(1)).toBe(groupKey(box.id));
        expect(project.ancestorsOf(pieceKey(1))).toEqual([lid.id, box.id]);
        expect(project.piecesIn(groupKey(box.id)).map((p) => p.id)).toEqual([1, 2, 3, 4]);
    });

    it('keeps a new group inside the group its members shared', () => {
        const project = projectWith(3);
        const outer = project.group([pieceKey(1), pieceKey(2), pieceKey(3)]);
        const inner = project.group([pieceKey(1), pieceKey(2)]);
        expect(inner.parentId).toBe(outer.id);
        expect(project.childrenOf(outer.id)).toEqual([groupKey(inner.id), pieceKey(3)]);
    });

    it('pulls members from different parents up to the top level', () => {
        const project = projectWith(4);
        const group = project.group([pieceKey(1), pieceKey(2), pieceKey(3)]);
        const mixed = project.group([pieceKey(1), pieceKey(4)]);
        expect(mixed.parentId).toBeNull();
        expect(project.childrenOf(group.id)).toEqual([pieceKey(2), pieceKey(3)]);
    });

    it('ignores pieces already covered by a selected group', () => {
        const project = projectWith(3);
        const inner = project.group([pieceKey(1), pieceKey(2)]);
        const outer = project.group([groupKey(inner.id), pieceKey(1), pieceKey(3)]);
        expect(project.getPiece(1).groupId).toBe(inner.id);
        expect(inner.parentId).toBe(outer.id);
    });

    it('needs at least two nodes', () => {
        const project = projectWith(2);
        expect(() => project.group([pieceKey(1)])).toThrow('at least two');
        expect(() => project.group([pieceKey(1), pieceKey(1)])).toThrow('at least two');
    });

    it('dissolves a group left with a single child', () => {
        const project = projectWith(3);
        const group = project.group([pieceKey(1), pieceKey(2)]);
        project.group([pieceKey(2), pieceKey(3)]);
        expect(project.getGroup(group.id)).toBeNull();
        expect(project.getPiece(1).groupId).toBeNull();
    });

    it('renames groups', () => {
        const project = projectWith(2);
        const group = project.group([pieceKey(1), pieceKey(2)]);
        project.renameGroup(group.id, 'Drawer');
        expect(project.getGroup(group.id).name).toBe('Drawer');
        expect(() => project.renameGroup(99, 'x')).toThrow('No group');
    });
});

describe('rotation', () => {
    it('defaults to no rotation and normalizes angles', () => {
        const project = new Project();
        const [a, b] = project.addPieces([panel, { ...panel, rotation: { y: 270 } }]);
        expect(a.rotation).toEqual({ x: 0, y: 0, z: 0 });
        expect(b.rotation).toEqual({ x: 0, y: -90, z: 0 });
    });

    it('updates single axes', () => {
        const project = projectWith(1);
        project.updatePiece(1, { rotation: { x: 45 } });
        project.updatePiece(1, { rotation: { z: -10 } });
        expect(project.getPiece(1).rotation).toEqual({ x: 45, y: 0, z: -10 });
    });

    it('rejects non-numeric angles', () => {
        const project = projectWith(1);
        expect(() => project.updatePiece(1, { rotation: { y: NaN } })).toThrow('rotation y');
        expect(project.getPiece(1).rotation.y).toBe(0);
    });

    it('starts groups unrotated', () => {
        const project = projectWith(2);
        expect(project.group([pieceKey(1), pieceKey(2)]).rotation).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('rotates a group about the average of its piece centres', () => {
        // Piece centres at x = 300 and 1300 -> pivot x = 800.
        const project = new Project();
        project.addPieces([panel, { ...panel, position: { x: 1000 } }]);
        const group = project.group([pieceKey(1), pieceKey(2)]);
        project.rotateGroup(group.id, { y: 90 });
        const [a, b] = project.pieces;
        expect(group.rotation).toEqual({ x: 0, y: 90, z: 0 });
        expect(a.rotation).toEqual({ x: 0, y: 90, z: 0 });
        expect(a.position.x + 300).toBeCloseTo(800);
        expect(b.position.x + 300).toBeCloseTo(800);
        expect(a.position.z + 9).toBeCloseTo(509);
        expect(b.position.z + 9).toBeCloseTo(-491);
    });

    it('turns a group back to where it was', () => {
        const project = new Project();
        project.addPieces([panel, { ...panel, position: { x: 1000, y: 50 }, rotation: { z: 30 } }]);
        const before = JSON.parse(JSON.stringify(project.pieces));
        const group = project.group([pieceKey(1), pieceKey(2)]);
        project.rotateGroup(group.id, { x: 20, y: 75 });
        project.rotateGroup(group.id, { z: -40 });
        project.rotateGroup(group.id, { x: 0, y: 0, z: 0 });
        project.pieces.forEach((piece, i) => {
            for (const axis of ['x', 'y', 'z']) {
                expect(piece.position[axis]).toBeCloseTo(before[i].position[axis], 6);
                expect(piece.rotation[axis]).toBeCloseTo(before[i].rotation[axis], 6);
            }
        });
    });

    it('rotates nested groups with their parent', () => {
        const project = projectWith(3);
        const inner = project.group([pieceKey(1), pieceKey(2)]);
        const outer = project.group([groupKey(inner.id), pieceKey(3)]);
        project.rotateGroup(outer.id, { z: 90 });
        expect(project.pieces.map((p) => p.rotation.z)).toEqual([90, 90, 90]);
    });

    it('rejects bad group rotations and unknown groups', () => {
        const project = projectWith(2);
        const group = project.group([pieceKey(1), pieceKey(2)]);
        expect(() => project.rotateGroup(group.id, { x: NaN })).toThrow('rotation x');
        expect(() => project.rotateGroup(99, { x: 1 })).toThrow('No group');
    });
});

describe('ungroup', () => {
    it('moves children up one level and selects them', () => {
        const project = projectWith(4);
        const lid = project.group([pieceKey(1), pieceKey(2)]);
        const box = project.group([groupKey(lid.id), pieceKey(3), pieceKey(4)]);
        project.ungroup([groupKey(box.id)]);
        expect(project.getGroup(box.id)).toBeNull();
        expect(lid.parentId).toBeNull();
        expect(project.selection).toEqual([groupKey(lid.id), pieceKey(3), pieceKey(4)]);
    });

    it('keeps selected pieces selected', () => {
        const project = projectWith(3);
        const group = project.group([pieceKey(1), pieceKey(2)]);
        project.ungroup([groupKey(group.id), pieceKey(3)]);
        expect(project.selection).toEqual([pieceKey(1), pieceKey(2), pieceKey(3)]);
    });
});

describe('remove', () => {
    it('removes a group with everything inside it', () => {
        const project = projectWith(4);
        const lid = project.group([pieceKey(1), pieceKey(2)]);
        const box = project.group([groupKey(lid.id), pieceKey(3)]);
        project.remove([groupKey(box.id)]);
        expect(project.pieces.map((p) => p.id)).toEqual([4]);
        expect(project.groups).toEqual([]);
        expect(project.selection).toEqual([]);
    });

    it('dissolves a group that drops below two pieces', () => {
        const project = projectWith(2);
        project.group([pieceKey(1), pieceKey(2)]);
        project.removePiece(1);
        expect(project.groups).toEqual([]);
        expect(project.getPiece(2).groupId).toBeNull();
    });

    it('selects the remaining child when a selected group dissolves', () => {
        const project = projectWith(2);
        project.group([pieceKey(1), pieceKey(2)]);
        project.remove([pieceKey(1)]);
        expect(project.selection).toEqual([pieceKey(2)]);
    });
});

describe('moveSelectionTo', () => {
    it('puts the corner of the selection at the value and keeps relative places', () => {
        const project = projectWith(3); // x = 0, 100, 200
        project.select([pieceKey(2), pieceKey(3)]);
        project.moveSelectionTo('x', 1000);
        expect(project.pieces.map((p) => p.position.x)).toEqual([0, 1000, 1100]);
    });

    it('measures from the rotated corners', () => {
        // 600 x 18 board turned a quarter about Y: its corners start at x = 291.
        const project = new Project();
        project.addPiece({ ...panel, rotation: { y: 90 } });
        project.select([pieceKey(1)]);
        project.moveSelectionTo('x', 0);
        expect(project.getPiece(1).position.x).toBeCloseTo(-291);
    });

    it('moves whole groups', () => {
        const project = projectWith(3);
        project.group([pieceKey(1), pieceKey(2)]);
        project.moveSelectionTo('y', 50);
        expect(project.pieces.map((p) => p.position.y)).toEqual([50, 50, 0]);
    });

    it('rejects non-numbers and ignores an empty selection', () => {
        const project = projectWith(1);
        expect(() => project.moveSelectionTo('x', NaN)).toThrow('position x');
        project.moveSelectionTo('x', 500);
        expect(project.getPiece(1).position.x).toBe(0);
    });
});

describe('addBox', () => {
    const box = [panel, panel, panel];

    it('groups the pieces as "Box N" and selects the box', () => {
        const project = new Project();
        const first = project.addBox(box);
        const second = project.addBox(box);
        expect([first.name, second.name]).toEqual(['Box 1', 'Box 2']);
        expect(project.selection).toEqual([groupKey(second.id)]);
        expect(project.piecesIn(groupKey(first.id))).toHaveLength(3);
    });

    it('numbers after the highest existing box, ignoring renamed ones', () => {
        const project = new Project();
        project.addBox(box);
        const renamed = project.addBox(box);
        project.renameGroup(renamed.id, 'Drawer');
        expect(project.addBox(box).name).toBe('Box 2');
    });

    it('is undone in one step', () => {
        const project = new Project();
        project.addBox(box);
        project.undo();
        expect(project.pieces).toEqual([]);
        expect(project.groups).toEqual([]);
        expect(project.canUndo).toBe(false);
    });
});

describe('undo and redo', () => {
    it('undoes and redoes each kind of change', () => {
        const project = projectWith(3);
        const steps = [
            () => project.updatePiece(1, { width: 10, rotation: { y: 45 } }),
            () => project.select([pieceKey(1), pieceKey(2)]) || project.moveSelection({ x: 5 }),
            () => project.group([pieceKey(1), pieceKey(2)]),
            () => project.renameGroup(1, 'Pair'),
            () => project.rotateGroup(1, { z: 90 }),
            () => project.ungroup([groupKey(1)]),
            () => project.remove([pieceKey(3)]),
            () => project.setName('Shelf'),
            () => project.replace({ name: 'Other', unit: 'in', pieces: [], groups: [], nextPieceId: 1, nextGroupId: 1 }),
        ];
        const state = () => JSON.stringify(project.pieces) + JSON.stringify(project.groups) + project.name;
        const states = [state()];
        for (const step of steps) {
            step();
            states.push(state());
        }
        for (let i = steps.length - 1; i >= 0; i--) {
            expect(project.undo()).toBe(true);
            expect(state()).toBe(states[i]);
        }
        expect(project.undo()).toBe(false);
        for (let i = 1; i <= steps.length; i++) {
            expect(project.redo()).toBe(true);
            expect(state()).toBe(states[i]);
        }
        expect(project.redo()).toBe(false);
    });

    it('does not record selection or unit changes', () => {
        const project = projectWith(1);
        project.select([pieceKey(1)]);
        project.toggle(pieceKey(1));
        project.setUnit('mm');
        expect(project.canUndo).toBe(false);
    });

    it('does not record changes that change nothing or fail', () => {
        const project = projectWith(2);
        project.moveSelection({ x: 5 }); // nothing selected
        project.select([pieceKey(1)]);
        project.moveSelection({ x: 0 });
        project.ungroup();
        project.remove([]);
        project.setName(project.name);
        expect(() => project.updatePiece(1, { width: -1 })).toThrow();
        expect(() => project.group([pieceKey(1)])).toThrow();
        expect(project.canUndo).toBe(false);
    });

    it('clears redo after a new change', () => {
        const project = projectWith(1);
        project.updatePiece(1, { width: 10 });
        project.undo();
        expect(project.canRedo).toBe(true);
        project.updatePiece(1, { width: 20 });
        expect(project.canRedo).toBe(false);
    });

    it('records a batch as one step', () => {
        const project = projectWith(1);
        project.select([pieceKey(1)]);
        project.beginBatch();
        for (let i = 0; i < 10; i++) {
            project.moveSelection({ x: 1 });
        }
        project.updatePiece(1, { width: 99 });
        project.endBatch();
        project.moveSelection({ x: 1 });
        expect(project.getPiece(1).position.x).toBe(11);
        project.undo();
        expect(project.getPiece(1).position.x).toBe(10);
        project.undo();
        expect(project.getPiece(1)).toMatchObject({ width: 600, position: { x: 0 } });
    });

    it('restores the selection from before the change', () => {
        const project = projectWith(2);
        project.select([pieceKey(1), pieceKey(2)]);
        project.group();
        expect(project.selection).toEqual([groupKey(1)]);
        project.undo();
        expect(project.selection).toEqual([pieceKey(1), pieceKey(2)]);
    });

    it(`keeps the last ${HISTORY_LIMIT} steps`, () => {
        const project = projectWith(1);
        for (let i = 1; i <= HISTORY_LIMIT + 20; i++) {
            project.updatePiece(1, { width: i });
        }
        let undone = 0;
        while (project.undo()) {
            undone++;
        }
        expect(undone).toBe(HISTORY_LIMIT);
        expect(project.getPiece(1).width).toBe(20);
    });

    it('notifies listeners on undo and redo', () => {
        const project = projectWith(1);
        project.updatePiece(1, { width: 10 });
        const listener = vi.fn();
        project.onChange(listener);
        project.undo();
        project.redo();
        expect(listener).toHaveBeenCalledTimes(2);
    });
});

describe('duplicate', () => {
    it('copies a piece next to the original as "(copy)" and selects it', () => {
        const project = projectWith(1);
        project.updatePiece(1, { name: 'Shelf', rotation: { y: 30 } });
        project.clearHistory();
        const [key] = project.duplicate([pieceKey(1)]);
        const copy = project.getNode(key);
        expect(copy).toMatchObject({ id: 2, name: 'Shelf (copy)', width: 600, rotation: { x: 0, y: 30, z: 0 } });
        expect(project.selection).toEqual([key]);
        // To the right of the original's (rotated) footprint, plus the gap.
        const original = project.getPiece(1);
        const width = bounds([original]).max.x - bounds([original]).min.x;
        expect(copy.position.x - original.position.x).toBeCloseTo(width + 50);
    });

    it('copies a nested group, only renaming the copied group', () => {
        const project = projectWith(4);
        const inner = project.group([pieceKey(1), pieceKey(2)]);
        const box = project.group([groupKey(inner.id), pieceKey(3)], { name: 'Box 1' });
        project.rotateGroup(box.id, { y: 10 });
        const [key] = project.duplicate([groupKey(box.id)]);
        const copy = project.getNode(key);
        expect(copy).toMatchObject({ name: 'Box 1 (copy)', parentId: null, rotation: { x: 0, y: 10, z: 0 } });
        const copies = project.piecesIn(key);
        expect(copies.map((p) => p.name)).toEqual(['Piece 1', 'Piece 2', 'Piece 3']);
        expect(copies.map((p) => p.id)).toEqual([5, 6, 7]);
        const innerCopy = project.childrenOf(copy.id).map((k) => project.getNode(k)).find((n) => n.parentId !== undefined);
        expect(innerCopy).toMatchObject({ name: 'Group 1', parentId: copy.id });
        expect(project.piecesIn(groupKey(box.id))).toHaveLength(3); // original untouched
        expect(project.groups).toHaveLength(4);
    });

    it('keeps relative positions and puts copies in the same parent', () => {
        const project = projectWith(3); // x = 0, 100, 200; each 600 wide
        const group = project.group([pieceKey(1), pieceKey(2), pieceKey(3)]);
        project.duplicate([pieceKey(1), pieceKey(3)]);
        const [a, b] = project.selection.map((k) => project.getNode(k));
        expect(b.position.x - a.position.x).toBe(200);
        expect(a.position.x).toBe(0 + 800 + 50); // selection spans 0..800
        expect([a.groupId, b.groupId]).toEqual([group.id, group.id]);
    });

    it('copies a group once even if pieces inside it are selected too', () => {
        const project = projectWith(2);
        const group = project.group([pieceKey(1), pieceKey(2)]);
        const keys = project.duplicate([groupKey(group.id), pieceKey(1)]);
        expect(keys).toHaveLength(1);
        expect(project.pieces).toHaveLength(4);
    });

    it('keeps numbering after copies and undoes in one step', () => {
        const project = projectWith(2);
        project.group([pieceKey(1), pieceKey(2)]);
        project.duplicate();
        expect(project.addPiece(panel).id).toBe(5);
        project.undo();
        project.undo();
        expect(project.pieces).toHaveLength(2);
        expect(project.groups).toHaveLength(1);
    });

    it('does nothing without a selection', () => {
        const project = projectWith(1);
        expect(project.duplicate()).toEqual([]);
        expect(project.canUndo).toBe(false);
    });
});

describe('sheet settings', () => {
    it('start at 4\' x 8\' with a 1/8" kerf and merge partial changes', () => {
        const project = new Project();
        expect(project.sheet).toEqual({ length: 2438.4, width: 1219.2, kerf: 3.175, allowRotate: true });
        project.setSheet({ allowRotate: false });
        expect(project.sheet.allowRotate).toBe(false);
        expect(project.sheet.length).toBe(2438.4);
    });

    it('reject bad values and are not undo steps', () => {
        const project = new Project();
        expect(() => project.setSheet({ width: 0 })).toThrow('Sheet width');
        project.setSheet({ kerf: 0 });
        expect(project.canUndo).toBe(false);
    });
});
