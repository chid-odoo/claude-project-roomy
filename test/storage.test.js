import { describe, expect, it, vi } from 'vitest';
import { createBox } from '../src/model/box.js';
import { groupKey, pieceKey, Project } from '../src/model/project.js';
import {
    AUTOSAVE_KEY, bindAutosave, deserialize, fileName, loadText, restoreAutosave, serialize, toJSONText,
} from '../src/model/storage.js';

// Two boxes, one rotated group nested in another, a renamed piece, metric units.
function sampleProject() {
    const project = new Project({ unit: 'mm', name: 'Toy chest' });
    project.addPieces(createBox({ width: 600, height: 400, depth: 300, thickness: 18 }));
    project.addPieces(createBox({ width: 300, height: 200, depth: 300, thickness: 12, origin: { x: 700 } }));
    const inner = project.group([1, 2, 3, 4, 5].map(pieceKey));
    project.group([groupKey(inner.id), pieceKey(6), pieceKey(7)]);
    project.rotateGroup(inner.id, { y: 30 });
    project.updatePiece(8, { name: 'Divider', rotation: { z: 15 } });
    return project;
}

class MemoryStorage {
    constructor() {
        this.items = new Map();
    }

    getItem(key) {
        return this.items.has(key) ? this.items.get(key) : null;
    }

    setItem(key, value) {
        this.items.set(key, String(value));
    }
}

describe('save and load', () => {
    it('round-trips a design exactly', () => {
        const original = sampleProject();
        const copy = new Project();
        loadText(copy, toJSONText(original));
        expect(serialize(copy)).toEqual(serialize(original));
        expect(copy.name).toBe('Toy chest');
        expect(copy.unit).toBe('mm');
    });

    it('replaces the current design and clears the selection', () => {
        const project = new Project();
        project.addPieces([{ width: 1, height: 1, depth: 1 }, { width: 1, height: 1, depth: 1 }]);
        project.select([pieceKey(1)]);
        const listener = vi.fn();
        project.onChange(listener);
        loadText(project, toJSONText(sampleProject()));
        expect(project.pieces).toHaveLength(10);
        expect(project.selection).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('keeps numbering groups after the loaded ones', () => {
        const project = new Project();
        loadText(project, toJSONText(sampleProject()));
        project.ungroup([groupKey(2)]);
        const group = project.group([pieceKey(9), pieceKey(10)]);
        expect(group.name).toBe('Group 3');
        expect(project.addPiece({ width: 1, height: 1, depth: 1 }).id).toBe(11);
    });

    it('never reuses ids even if the stored counters are too low', () => {
        const data = serialize(sampleProject());
        data.nextPieceId = 1;
        delete data.nextGroupId;
        const state = deserialize(data);
        expect(state.nextPieceId).toBe(11);
        expect(state.nextGroupId).toBe(3);
    });

    it('stores plain, readable JSON', () => {
        const data = JSON.parse(toJSONText(sampleProject()));
        expect(data).toMatchObject({ format: 'roomy-project', version: 1, name: 'Toy chest', unit: 'mm' });
        expect(data.groups[0]).toEqual({ id: 1, name: 'Group 1', parentId: 2, rotation: { x: 0, y: 30, z: 0 } });
        expect(data.pieces[7]).toMatchObject({ id: 8, name: 'Divider', groupId: null, rotation: { x: 0, y: 0, z: 15 } });
    });
});

describe('sheet settings', () => {
    it('are saved and loaded with the design', () => {
        const original = sampleProject();
        original.setSheet({ length: 1219.2, width: 609.6, kerf: 2.4, allowRotate: false });
        const copy = new Project();
        loadText(copy, toJSONText(original));
        expect(copy.sheet).toEqual({ length: 1219.2, width: 609.6, kerf: 2.4, allowRotate: false });
    });

    it('default for files saved before they existed', () => {
        const data = serialize(sampleProject());
        delete data.sheet;
        expect(deserialize(data).sheet).toEqual({ length: 2438.4, width: 1219.2, kerf: 3.175, allowRotate: true });
    });

    it('are checked', () => {
        const data = serialize(sampleProject());
        data.sheet.kerf = -2;
        expect(() => deserialize(data)).toThrow('Not a valid Roomy file: Saw kerf');
    });
});

describe('rejecting bad files', () => {
    const broken = (change) => {
        const data = serialize(sampleProject());
        change(data);
        return () => deserialize(data);
    };

    it('rejects text that is not JSON or not a Roomy file', () => {
        expect(() => loadText(new Project(), '{oops')).toThrow('not JSON');
        expect(() => loadText(new Project(), '[]')).toThrow('unknown file format');
        expect(() => loadText(new Project(), 'null')).toThrow('expected a JSON object');
    });

    it('rejects files from a newer version', () => {
        expect(broken((d) => { d.version = 2; })).toThrow('newer version');
    });

    it('rejects unknown units and bad pieces', () => {
        expect(broken((d) => { d.unit = 'yd'; })).toThrow('unknown unit');
        expect(broken((d) => { d.pieces[0].width = -5; })).toThrow('piece 1: width');
        expect(broken((d) => { d.pieces[0].position.x = 'a'; })).toThrow('position x');
        expect(broken((d) => { d.pieces[1].id = 1; })).toThrow('duplicate piece ids');
        expect(broken((d) => { d.pieces[0].groupId = 99; })).toThrow('missing group');
    });

    it('rejects broken group trees', () => {
        expect(broken((d) => { d.groups[0].parentId = 42; })).toThrow('missing parent');
        expect(broken((d) => { d.groups[1].parentId = 1; })).toThrow('inside itself');
        expect(broken((d) => { d.groups[1].id = 1; })).toThrow('duplicate group ids');
    });

    it('leaves the current design alone when loading fails', () => {
        const project = sampleProject();
        const before = serialize(project);
        expect(() => loadText(project, '{"format":"roomy-project","version":1}')).toThrow();
        expect(serialize(project)).toEqual(before);
    });
});

describe('fileName', () => {
    it('makes a safe file name from the design name', () => {
        expect(fileName('Toy chest')).toBe('toy-chest.json');
        expect(fileName('My Shelf / v2!')).toBe('my-shelf-v2.json');
        expect(fileName('  ')).toBe('roomy-design.json');
    });
});

describe('auto-save', () => {
    it('saves shortly after changes and restores on the next start', () => {
        vi.useFakeTimers();
        const storage = new MemoryStorage();
        const project = new Project();
        bindAutosave(project, storage);
        project.addPiece({ width: 10, height: 20, depth: 30, name: 'Kept' });
        expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
        vi.advanceTimersByTime(300);
        vi.useRealTimers();

        const next = new Project();
        expect(restoreAutosave(next, storage)).toBe(true);
        expect(next.pieces[0]).toMatchObject({ name: 'Kept', width: 10 });
        expect(next.canUndo).toBe(false); // restoring is not an undoable change
    });

    it('starts fresh when there is nothing saved, the save is corrupt, or storage throws', () => {
        const project = new Project();
        expect(restoreAutosave(project, new MemoryStorage())).toBe(false);
        const corrupt = new MemoryStorage();
        corrupt.setItem(AUTOSAVE_KEY, '{nope');
        expect(restoreAutosave(project, corrupt)).toBe(false);
        expect(restoreAutosave(project, { getItem: () => { throw new Error('blocked'); } })).toBe(false);
        expect(restoreAutosave(project, null)).toBe(false);
        expect(project.pieces).toEqual([]);
    });

    it('ignores storage that refuses writes', () => {
        const project = new Project();
        const save = bindAutosave(project, { setItem: () => { throw new Error('full'); } });
        expect(() => save()).not.toThrow();
    });
});
