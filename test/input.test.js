import { describe, expect, it } from 'vitest';
import { groupKey, pieceKey, Project } from '../src/model/project.js';
import { applyKeyAction, bindKeyboard, keyAction, pickPiece } from '../src/ui/input.js';

const panel = { width: 600, height: 400, depth: 18 };

// Pieces 1-4; pieces 1 and 2 in Group 1, which sits inside Group 2 with piece 3.
function nestedProject() {
    const project = new Project();
    project.addPieces([panel, panel, panel, panel]);
    project.group([pieceKey(1), pieceKey(2)]);
    project.group([groupKey(1), pieceKey(3)]);
    project.clearSelection();
    project.clearHistory();
    return project;
}

describe('pickPiece', () => {
    it('selects the outermost group of a clicked piece', () => {
        const project = nestedProject();
        pickPiece(project, 1);
        expect(project.selection).toEqual([groupKey(2)]);
    });

    it('selects an ungrouped piece directly', () => {
        const project = nestedProject();
        pickPiece(project, 4);
        expect(project.selection).toEqual([pieceKey(4)]);
    });

    it('selects only the piece on double click', () => {
        const project = nestedProject();
        pickPiece(project, 1);
        pickPiece(project, 1, { double: true });
        expect(project.selection).toEqual([pieceKey(1)]);
    });

    it('adds and removes with additive clicks', () => {
        const project = nestedProject();
        pickPiece(project, 4);
        pickPiece(project, 3, { additive: true });
        expect(project.selection).toEqual([pieceKey(4), groupKey(2)]);
        pickPiece(project, 1, { additive: true });
        expect(project.selection).toEqual([pieceKey(4)]);
    });

    it('adds a single grouped piece with an additive double click', () => {
        const project = nestedProject();
        pickPiece(project, 4);
        pickPiece(project, 1, { additive: true });
        pickPiece(project, 1, { additive: true, double: true });
        expect(project.selection).toEqual([pieceKey(4), pieceKey(1)]);
    });

    it('clears the selection when clicking empty space, unless additive', () => {
        const project = nestedProject();
        pickPiece(project, 4);
        pickPiece(project, null, { additive: true });
        expect(project.selection).toEqual([pieceKey(4)]);
        pickPiece(project, null);
        expect(project.selection).toEqual([]);
    });
});

describe('keyAction', () => {
    it('maps arrows to X and Z, and Shift+Up/Down to Y', () => {
        expect(keyAction({ key: 'ArrowLeft' })).toEqual({ type: 'move', axis: 'x', direction: -1 });
        expect(keyAction({ key: 'ArrowRight' })).toEqual({ type: 'move', axis: 'x', direction: 1 });
        expect(keyAction({ key: 'ArrowUp' })).toEqual({ type: 'move', axis: 'z', direction: -1 });
        expect(keyAction({ key: 'ArrowDown' })).toEqual({ type: 'move', axis: 'z', direction: 1 });
        expect(keyAction({ key: 'ArrowUp', shiftKey: true })).toEqual({ type: 'move', axis: 'y', direction: 1 });
        expect(keyAction({ key: 'ArrowDown', shiftKey: true })).toEqual({ type: 'move', axis: 'y', direction: -1 });
    });

    it('maps Ctrl/Cmd+G to group and with Shift to ungroup', () => {
        expect(keyAction({ key: 'g', ctrlKey: true })).toEqual({ type: 'group' });
        expect(keyAction({ key: 'g', metaKey: true })).toEqual({ type: 'group' });
        expect(keyAction({ key: 'G', ctrlKey: true, shiftKey: true })).toEqual({ type: 'ungroup' });
    });

    it('maps Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y to redo', () => {
        expect(keyAction({ key: 'z', ctrlKey: true })).toEqual({ type: 'undo' });
        expect(keyAction({ key: 'z', metaKey: true })).toEqual({ type: 'undo' });
        expect(keyAction({ key: 'Z', ctrlKey: true, shiftKey: true })).toEqual({ type: 'redo' });
        expect(keyAction({ key: 'y', ctrlKey: true })).toEqual({ type: 'redo' });
        expect(keyAction({ key: 'z', ctrlKey: true, altKey: true })).toBeNull();
    });

    it('maps Ctrl/Cmd+D to duplicate', () => {
        expect(keyAction({ key: 'd', ctrlKey: true })).toEqual({ type: 'duplicate' });
        expect(keyAction({ key: 'd', metaKey: true })).toEqual({ type: 'duplicate' });
        expect(keyAction({ key: 'D', ctrlKey: true, shiftKey: true })).toBeNull();
    });

    it('ignores other keys and modifier combinations', () => {
        expect(keyAction({ key: 'g' })).toBeNull();
        expect(keyAction({ key: 'a', ctrlKey: true })).toBeNull();
        expect(keyAction({ key: 'ArrowLeft', ctrlKey: true })).toBeNull();
        expect(keyAction({ key: 'ArrowLeft', altKey: true })).toBeNull();
        expect(keyAction({ key: 'ArrowLeft', shiftKey: true })).toBeNull();
    });
});

describe('applyKeyAction', () => {
    it('moves the selection by one step', () => {
        const project = nestedProject();
        pickPiece(project, 1);
        expect(applyKeyAction(project, keyAction({ key: 'ArrowUp', shiftKey: true }), 6.35)).toBe(true);
        expect(project.pieces.map((p) => p.position.y)).toEqual([6.35, 6.35, 6.35, 0]);
    });

    it('does nothing without a selection', () => {
        const project = nestedProject();
        expect(applyKeyAction(project, keyAction({ key: 'ArrowLeft' }), 10)).toBe(false);
        expect(project.pieces.every((p) => p.position.x === 0)).toBe(true);
    });

    it('groups only with two or more selected', () => {
        const project = nestedProject();
        pickPiece(project, 4);
        expect(applyKeyAction(project, { type: 'group' }, 10)).toBe(false);
        pickPiece(project, 1, { additive: true });
        expect(applyKeyAction(project, { type: 'group' }, 10)).toBe(true);
        expect(project.selectedGroup.name).toBe('Group 3');
    });

    it('duplicates the selection, and not without one', () => {
        const project = nestedProject();
        expect(applyKeyAction(project, { type: 'duplicate' }, 10)).toBe(false);
        pickPiece(project, 4);
        expect(applyKeyAction(project, { type: 'duplicate' }, 10)).toBe(true);
        expect(project.selectedPiece.name).toBe('Piece 4 (copy)');
    });

    it('ungroups the selected group', () => {
        const project = nestedProject();
        pickPiece(project, 1);
        expect(applyKeyAction(project, { type: 'ungroup' }, 10)).toBe(true);
        expect(project.selection).toEqual([groupKey(1), pieceKey(3)]);
    });
});

describe('bindKeyboard', () => {
    const key = (type, props) => Object.assign(new Event(type, { cancelable: true }), { repeat: false, ...props });

    function setup() {
        const project = nestedProject();
        const target = new EventTarget();
        bindKeyboard(target, project, () => 10);
        pickPiece(project, 4);
        return { project, target };
    }

    it('makes a held arrow key one undo step, and separate presses separate steps', () => {
        const { project, target } = setup();
        target.dispatchEvent(key('keydown', { key: 'ArrowRight' }));
        target.dispatchEvent(key('keydown', { key: 'ArrowRight', repeat: true }));
        target.dispatchEvent(key('keydown', { key: 'ArrowRight', repeat: true }));
        target.dispatchEvent(key('keyup', { key: 'ArrowRight' }));
        target.dispatchEvent(key('keydown', { key: 'ArrowRight' }));
        target.dispatchEvent(key('keyup', { key: 'ArrowRight' }));
        expect(project.getPiece(4).position.x).toBe(40);
        target.dispatchEvent(key('keydown', { key: 'z', ctrlKey: true }));
        expect(project.getPiece(4).position.x).toBe(30);
        target.dispatchEvent(key('keydown', { key: 'z', ctrlKey: true }));
        expect(project.getPiece(4).position.x).toBe(0);
        target.dispatchEvent(key('keydown', { key: 'y', ctrlKey: true }));
        expect(project.getPiece(4).position.x).toBe(30);
    });

    it('prevents the browser default only when something happened', () => {
        const { project, target } = setup();
        const undo = key('keydown', { key: 'z', ctrlKey: true });
        target.dispatchEvent(undo);
        expect(undo.defaultPrevented).toBe(false); // nothing to undo yet
        const move = key('keydown', { key: 'ArrowUp' });
        target.dispatchEvent(move);
        expect(move.defaultPrevented).toBe(true);
        expect(project.canUndo).toBe(true);
    });
});
