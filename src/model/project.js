// A project is a list of pieces, optionally organised in nested groups.
// Each piece is a board: width along X, height along Y (up), depth along Z,
// all in millimetres. `position` is the corner with the smallest x, y and z
// before rotation; `rotation` is in degrees about the piece's centre (see
// geometry.js).
//
// Pieces and groups are both "nodes" and are referred to by key:
// 'piece:3' or 'group:2'. The selection is a list of node keys.
//
// Every change to the design records an undo step first. Selection, the
// display unit and the stock sheet settings are not part of the design and
// are not recorded.

import {
    alongPiece, bounds, centroid, normalizeAngle, pieceCenter, quaternionOf, rotatePiecesAbout, ZERO_ROTATION,
} from './geometry.js';
import { DEFAULT_SHEET, validateSheet } from './sheets.js';
import { thicknessChanges } from './thickness.js';

export const DIMENSIONS = ['width', 'height', 'depth'];
export const AXES = ['x', 'y', 'z'];
export const DIMENSION_OF_AXIS = { x: 'width', y: 'height', z: 'depth' };

export const HISTORY_LIMIT = 100;

export const pieceKey = (id) => `piece:${id}`;
export const groupKey = (id) => `group:${id}`;

export function parseKey(key) {
    const [kind, id] = key.split(':');
    return { kind, id: Number(id) };
}

export class Project {
    constructor({ unit = 'in', name = 'Untitled' } = {}) {
        this.name = name;
        this.unit = unit;
        this.sheet = { ...DEFAULT_SHEET };
        this.pieces = [];
        this.groups = [];
        this.selection = [];
        this._nextPieceId = 1;
        this._nextGroupId = 1;
        this._listeners = new Set();
        this._past = [];
        this._future = [];
        this._batchDepth = 0;
        this._batchRecorded = false;
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _emit() {
        for (const listener of this._listeners) {
            listener(this);
        }
    }

    // ---- undo / redo -----------------------------------------------------

    _snapshot() {
        return JSON.parse(JSON.stringify({
            name: this.name,
            pieces: this.pieces,
            groups: this.groups,
            selection: this.selection,
            nextPieceId: this._nextPieceId,
            nextGroupId: this._nextGroupId,
        }));
    }

    _restore(snapshot) {
        this.name = snapshot.name;
        this.pieces = snapshot.pieces;
        this.groups = snapshot.groups;
        this._nextPieceId = snapshot.nextPieceId;
        this._nextGroupId = snapshot.nextGroupId;
        this.selection = snapshot.selection.filter((key) => this.getNode(key));
    }

    // Call before changing the design. Inside a batch only the first call
    // records, so a whole drag or a held arrow key is one undo step.
    _record() {
        if (this._batchDepth > 0) {
            if (this._batchRecorded) {
                return;
            }
            this._batchRecorded = true;
        }
        this._past.push(this._snapshot());
        if (this._past.length > HISTORY_LIMIT) {
            this._past.shift();
        }
        this._future = [];
    }

    beginBatch() {
        if (this._batchDepth++ === 0) {
            this._batchRecorded = false;
        }
    }

    endBatch() {
        this._batchDepth = Math.max(0, this._batchDepth - 1);
    }

    clearHistory() {
        this._past = [];
        this._future = [];
    }

    get canUndo() {
        return this._past.length > 0;
    }

    get canRedo() {
        return this._future.length > 0;
    }

    undo() {
        if (!this._past.length) {
            return false;
        }
        this._batchDepth = 0;
        this._future.push(this._snapshot());
        this._restore(this._past.pop());
        this._emit();
        return true;
    }

    redo() {
        if (!this._future.length) {
            return false;
        }
        this._batchDepth = 0;
        this._past.push(this._snapshot());
        this._restore(this._future.pop());
        this._emit();
        return true;
    }

    // ---- lookups ---------------------------------------------------------

    getPiece(id) {
        return this.pieces.find((piece) => piece.id === id) || null;
    }

    getGroup(id) {
        return this.groups.find((group) => group.id === id) || null;
    }

    getNode(key) {
        const { kind, id } = parseKey(key);
        return kind === 'piece' ? this.getPiece(id) : kind === 'group' ? this.getGroup(id) : null;
    }

    parentOf(key) {
        const node = this.getNode(key);
        if (!node) {
            return null;
        }
        return parseKey(key).kind === 'piece' ? node.groupId : node.parentId;
    }

    _setParent(key, groupId) {
        const node = this.getNode(key);
        if (parseKey(key).kind === 'piece') {
            node.groupId = groupId;
        } else {
            node.parentId = groupId;
        }
    }

    // Direct children of a group, or the top-level nodes for `null`.
    childrenOf(groupId) {
        return [
            ...this.groups.filter((group) => group.parentId === groupId).map((group) => groupKey(group.id)),
            ...this.pieces.filter((piece) => piece.groupId === groupId).map((piece) => pieceKey(piece.id)),
        ];
    }

    // Groups containing `key`, innermost first.
    ancestorsOf(key) {
        const ancestors = [];
        let parent = this.parentOf(key);
        while (parent !== null && parent !== undefined) {
            ancestors.push(parent);
            parent = this.getGroup(parent).parentId;
        }
        return ancestors;
    }

    // The node to select when a piece is clicked: its outermost group.
    topLevelKey(pieceId) {
        const ancestors = this.ancestorsOf(pieceKey(pieceId));
        return ancestors.length ? groupKey(ancestors[ancestors.length - 1]) : pieceKey(pieceId);
    }

    // All pieces inside a node, however deeply nested.
    piecesIn(key) {
        const { kind, id } = parseKey(key);
        if (kind === 'piece') {
            const piece = this.getPiece(id);
            return piece ? [piece] : [];
        }
        return this.childrenOf(id).flatMap((child) => this.piecesIn(child));
    }

    get selectedPieces() {
        const seen = new Set();
        return this.selection.flatMap((key) => this.piecesIn(key)).filter((piece) => {
            if (seen.has(piece.id)) {
                return false;
            }
            seen.add(piece.id);
            return true;
        });
    }

    // The piece being edited when exactly one piece is selected.
    get selectedPiece() {
        if (this.selection.length !== 1 || parseKey(this.selection[0]).kind !== 'piece') {
            return null;
        }
        return this.getNode(this.selection[0]);
    }

    get selectedGroup() {
        if (this.selection.length !== 1 || parseKey(this.selection[0]).kind !== 'group') {
            return null;
        }
        return this.getNode(this.selection[0]);
    }

    // ---- pieces ----------------------------------------------------------

    addPieces(specs) {
        specs.forEach(validatePiece);
        this._record();
        const added = specs.map((spec) => {
            const id = this._nextPieceId++;
            return {
                id,
                name: spec.name || `Piece ${id}`,
                width: spec.width,
                height: spec.height,
                depth: spec.depth,
                position: { x: 0, y: 0, z: 0, ...spec.position },
                rotation: normalizeRotation({ ...ZERO_ROTATION, ...spec.rotation }),
                groupId: null,
            };
        });
        this.pieces.push(...added);
        this._emit();
        return added;
    }

    addPiece(spec) {
        return this.addPieces([spec])[0];
    }

    // Add the pieces of a box as one group named "Box N", selected. One undo
    // step removes the whole box.
    addBox(specs) {
        this.beginBatch();
        try {
            const pieces = this.addPieces(specs);
            return this.group(pieces.map((piece) => pieceKey(piece.id)), { name: this._nextBoxName() });
        } finally {
            this.endBatch();
        }
    }

    _nextBoxName() {
        const numbers = this.groups.map((group) => /^Box (\d+)$/.exec(group.name)).filter(Boolean).map((m) => Number(m[1]));
        return `Box ${Math.max(0, ...numbers) + 1}`;
    }

    // `changes` may hold name, width, height, depth and a partial position
    // or rotation.
    updatePiece(id, changes) {
        const piece = this.getPiece(id);
        if (!piece) {
            throw new Error(`No piece with id ${id}`);
        }
        const next = {
            ...piece,
            ...changes,
            position: { ...piece.position, ...changes.position },
            rotation: { ...piece.rotation, ...changes.rotation },
        };
        validatePiece(next);
        next.rotation = normalizeRotation(next.rotation);
        this._record();
        Object.assign(piece, next);
        this._emit();
        return piece;
    }

    // Cut a piece in two across one of its own axes ('x' = its width,
    // 'y' = height, 'z' = depth). The first piece is `at` mm long, measured
    // from the piece's low edge (left, bottom or back before rotation). The
    // cut has no width: the saw kerf only counts in the sheet estimate.
    // The original becomes "<name> A" and a new "<name> B" follows it, both
    // exactly where their part of the board was, in the same group, and both
    // selected. Returns [a, b].
    splitPiece(id, axis, at) {
        const piece = this.getPiece(id);
        if (!piece) {
            throw new Error(`No piece with id ${id}`);
        }
        const dim = DIMENSION_OF_AXIS[axis];
        if (!dim) {
            throw new Error(`Unknown axis: ${axis}`);
        }
        const size = piece[dim];
        if (!(Number.isFinite(at) && at > 1e-6 && at < size - 1e-6)) {
            throw new Error('The cut must be inside the piece');
        }
        this._record();
        const center = pieceCenter(piece);
        // Corner of a part `length` long whose low edge is `from` along the
        // axis, keeping the part's centre where it was on the board.
        const placePart = (from, length) => {
            const shift = alongPiece(piece, axis, from + length / 2 - size / 2);
            const dims = { width: piece.width, height: piece.height, depth: piece.depth, [dim]: length };
            return {
                [dim]: length,
                position: {
                    x: center.x + shift.x - dims.width / 2,
                    y: center.y + shift.y - dims.height / 2,
                    z: center.z + shift.z - dims.depth / 2,
                },
            };
        };
        const second = {
            ...JSON.parse(JSON.stringify(piece)),
            ...placePart(at, size - at),
            id: this._nextPieceId++,
            name: `${piece.name} B`,
        };
        Object.assign(piece, placePart(0, at), { name: `${piece.name} A` });
        this.pieces.splice(this.pieces.indexOf(piece) + 1, 0, second);
        this.selection = [pieceKey(piece.id), pieceKey(second.id)];
        this._emit();
        return [piece, second];
    }

    // Shift every selected piece (including those inside selected groups).
    moveSelection(offset) {
        const pieces = this.selectedPieces;
        if (!pieces.length || AXES.every((axis) => !offset[axis])) {
            return;
        }
        this._record();
        for (const piece of pieces) {
            for (const axis of AXES) {
                piece.position[axis] += offset[axis] || 0;
            }
        }
        this._emit();
    }

    // Move the selection so the corner of its bounding box nearest the
    // origin sits at `value` on `axis`. Everything keeps its relative place.
    moveSelectionTo(axis, value) {
        if (!Number.isFinite(value)) {
            throw new Error(`position ${axis} must be a number`);
        }
        const box = bounds(this.selectedPieces);
        if (box) {
            this.moveSelection({ [axis]: value - box.min[axis] });
        }
    }

    // Move one piece so the corner of its rotated bounding box nearest the
    // origin sits at `value` on `axis`: the position the user sees, not the
    // stored corner from before rotation.
    movePieceTo(id, axis, value) {
        const piece = this.getPiece(id);
        if (!piece) {
            throw new Error(`No piece with id ${id}`);
        }
        if (!Number.isFinite(value)) {
            throw new Error(`position ${axis} must be a number`);
        }
        const offset = value - bounds([piece]).min[axis];
        if (!offset) {
            return;
        }
        this._record();
        piece.position[axis] += offset;
        this._emit();
    }

    // Make the given pieces `thickness` thick, keeping butt joints closed
    // (see thickness.js). One undo step.
    setThickness(ids, thickness) {
        if (!(Number.isFinite(thickness) && thickness > 0)) {
            throw new Error('Thickness must be a positive number');
        }
        const targets = ids.map((id) => this.getPiece(id)).filter(Boolean);
        const centres = new Map();
        for (const piece of targets) {
            if (piece.groupId !== null && piece.groupId !== undefined) {
                const box = bounds(this.piecesIn(groupKey(piece.groupId)));
                centres.set(piece.id, Object.fromEntries(AXES.map((axis) => [axis, (box.min[axis] + box.max[axis]) / 2])));
            }
        }
        const changes = thicknessChanges(this.pieces, targets, thickness, centres);
        if (!changes.size) {
            return;
        }
        this._record();
        for (const [id, change] of changes) {
            Object.assign(this.getPiece(id), change);
        }
        this._emit();
    }

    // Delete the given nodes and everything inside them.
    remove(keys = this.selection) {
        const pieceIds = new Set(keys.flatMap((key) => this.piecesIn(key)).map((piece) => piece.id));
        if (!pieceIds.size) {
            return;
        }
        this._record();
        this.pieces = this.pieces.filter((piece) => !pieceIds.has(piece.id));
        this._prune();
        this._emit();
    }

    removePiece(id) {
        this.remove([pieceKey(id)]);
    }

    // Copy the given nodes (pieces, or groups with everything inside) and
    // select the copies. Copies keep their parent and sit `gap` mm to the
    // right of the originals' bounding box, arranged as the originals are.
    // Only the copied items' own names get " (copy)"; pieces inside a copied
    // group keep theirs. Returns the new keys.
    duplicate(keys = this.selection, { gap = 50 } = {}) {
        const nodes = this._outermost(keys);
        if (!nodes.length) {
            return [];
        }
        this._record();
        const box = bounds(nodes.flatMap((key) => this.piecesIn(key)));
        const dx = box.max.x - box.min.x + gap;
        const copy = (key, parentId, rename) => {
            const { kind, id } = parseKey(key);
            const node = this.getNode(key);
            const name = rename ? `${node.name} (copy)` : node.name;
            if (kind === 'piece') {
                const piece = JSON.parse(JSON.stringify(node));
                Object.assign(piece, { id: this._nextPieceId++, name, groupId: parentId });
                piece.position.x += dx;
                this.pieces.push(piece);
                return pieceKey(piece.id);
            }
            const group = { id: this._nextGroupId++, name, parentId, rotation: { ...node.rotation } };
            this.groups.push(group);
            for (const child of this.childrenOf(id)) {
                copy(child, group.id, false);
            }
            return groupKey(group.id);
        };
        this.selection = nodes.map((key) => copy(key, this.parentOf(key), true));
        this._emit();
        return this.selection;
    }

    // Known keys without duplicates or nodes inside another listed group.
    _outermost(keys) {
        const known = [...new Set(keys)].filter((key) => this.getNode(key));
        return known.filter((key) => !this.ancestorsOf(key).some((id) => known.includes(groupKey(id))));
    }

    // ---- groups ----------------------------------------------------------

    // Put the nodes in a new group, named "Group N" unless `name` is given.
    // The group goes where the nodes were if they shared a parent, otherwise
    // at the top level.
    group(keys = this.selection, { name } = {}) {
        const nodes = this._outermost(keys);
        if (nodes.length < 2) {
            throw new Error('Select at least two pieces or groups to group');
        }
        this._record();
        const parents = new Set(nodes.map((key) => this.parentOf(key)));
        const id = this._nextGroupId++;
        const group = {
            id,
            name: name || `Group ${id}`,
            parentId: parents.size === 1 ? [...parents][0] : null,
            rotation: { ...ZERO_ROTATION },
        };
        this.groups.push(group);
        for (const key of nodes) {
            this._setParent(key, id);
        }
        this.selection = [groupKey(id)];
        this._prune();
        this._emit();
        return group;
    }

    // Dissolve the selected groups one level; their children are selected.
    ungroup(keys = this.selection) {
        if (!keys.some((key) => parseKey(key).kind === 'group' && this.getNode(key))) {
            return;
        }
        this._record();
        const selection = [];
        for (const key of keys) {
            const { kind, id } = parseKey(key);
            const group = kind === 'group' && this.getGroup(id);
            if (!group) {
                selection.push(key);
                continue;
            }
            const children = this.childrenOf(id);
            for (const child of children) {
                this._setParent(child, group.parentId);
            }
            this.groups = this.groups.filter((other) => other !== group);
            selection.push(...children);
        }
        this.selection = selection;
        this._prune();
        this._emit();
    }

    // Set a group's rotation (partial, in degrees). Everything inside turns
    // by the difference from its previous rotation, about the group's centre.
    rotateGroup(id, rotation) {
        const group = this.getGroup(id);
        if (!group) {
            throw new Error(`No group with id ${id}`);
        }
        const next = { ...group.rotation, ...rotation };
        validateRotation(next);
        this._record();
        const pieces = this.piecesIn(groupKey(id));
        const delta = quaternionOf(next).multiply(quaternionOf(group.rotation).invert());
        rotatePiecesAbout(pieces, delta, centroid(pieces));
        group.rotation = normalizeRotation(next);
        this._emit();
    }

    renameGroup(id, name) {
        const group = this.getGroup(id);
        if (!group) {
            throw new Error(`No group with id ${id}`);
        }
        if (group.name === name) {
            return;
        }
        this._record();
        group.name = name;
        this._emit();
    }

    // A group needs two children to mean anything: empty groups are removed
    // and a group left with one child is replaced by that child.
    _prune() {
        let changed = true;
        while (changed) {
            changed = false;
            for (const group of this.groups) {
                const children = this.childrenOf(group.id);
                if (children.length < 2) {
                    for (const child of children) {
                        this._setParent(child, group.parentId);
                    }
                    this.groups = this.groups.filter((other) => other !== group);
                    this.selection = this.selection.flatMap((key) => (key === groupKey(group.id) ? children : [key]));
                    changed = true;
                    break;
                }
            }
        }
        this.selection = this.selection.filter((key, index, all) => this.getNode(key) && all.indexOf(key) === index);
    }

    // ---- selection & settings -------------------------------------------

    select(keys) {
        this.selection = keys.filter((key, index) => this.getNode(key) && keys.indexOf(key) === index);
        this._emit();
    }

    toggle(key) {
        if (this.selection.includes(key)) {
            this.selection = this.selection.filter((other) => other !== key);
        } else if (this.getNode(key)) {
            this.selection = [...this.selection, key];
        }
        this._emit();
    }

    clearSelection() {
        this.select([]);
    }

    setName(name) {
        if (this.name === name) {
            return;
        }
        this._record();
        this.name = name;
        this._emit();
    }

    // Replace the whole design with saved state (see storage.js, which
    // validates it first). Clears the selection. Undoable unless
    // `record: false` (used when restoring the auto-save at start-up).
    replace({ name, unit, sheet, pieces, groups, nextPieceId, nextGroupId }, { record = true } = {}) {
        if (record) {
            this._record();
        }
        this.name = name;
        this.unit = unit;
        if (sheet) {
            this.sheet = { ...sheet };
        }
        this.pieces = pieces;
        this.groups = groups;
        this.selection = [];
        this._nextPieceId = nextPieceId;
        this._nextGroupId = nextGroupId;
        this._emit();
    }

    // Stock sheet used for the sheet estimate: length, width, kerf (mm) and
    // allowRotate. Partial changes are merged.
    setSheet(changes) {
        const next = { ...this.sheet, ...changes };
        validateSheet(next);
        this.sheet = next;
        this._emit();
    }

    setUnit(unit) {
        this.unit = unit;
        this._emit();
    }
}

export function validatePiece(piece) {
    for (const dim of DIMENSIONS) {
        if (!(Number.isFinite(piece[dim]) && piece[dim] > 0)) {
            throw new Error(`${dim} must be a positive number`);
        }
    }
    for (const axis of AXES) {
        const value = piece.position ? piece.position[axis] : 0;
        if (value !== undefined && !Number.isFinite(value)) {
            throw new Error(`position ${axis} must be a number`);
        }
    }
    validateRotation(piece.rotation || {});
}

function validateRotation(rotation) {
    for (const axis of AXES) {
        if (rotation[axis] !== undefined && !Number.isFinite(rotation[axis])) {
            throw new Error(`rotation ${axis} must be a number`);
        }
    }
}

function normalizeRotation(rotation) {
    return Object.fromEntries(AXES.map((axis) => [axis, normalizeAngle(rotation[axis])]));
}
