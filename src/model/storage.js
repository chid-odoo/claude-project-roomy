// Saving and loading designs: a versioned JSON format, used both for files
// people share and for the browser auto-save.
import { AXES, DIMENSIONS, validatePiece } from './project.js';
import { normalizeAngle } from './geometry.js';
import { DEFAULT_SHEET, validateSheet } from './sheets.js';
import { UNITS } from './units.js';

export const FORMAT = 'roomy-project';
export const VERSION = 1;
export const AUTOSAVE_KEY = 'roomy:autosave';

export function serialize(project) {
    return {
        format: FORMAT,
        version: VERSION,
        name: project.name,
        unit: project.unit,
        sheet: { ...project.sheet },
        pieces: project.pieces.map((piece) => ({
            id: piece.id,
            name: piece.name,
            width: piece.width,
            height: piece.height,
            depth: piece.depth,
            position: { ...piece.position },
            rotation: { ...piece.rotation },
            groupId: piece.groupId,
        })),
        groups: project.groups.map((group) => ({
            id: group.id,
            name: group.name,
            parentId: group.parentId,
            rotation: { ...group.rotation },
        })),
        nextPieceId: project._nextPieceId,
        nextGroupId: project._nextGroupId,
    };
}

export function toJSONText(project) {
    return `${JSON.stringify(serialize(project), null, 2)}\n`;
}

class FormatError extends Error {}

function check(condition, message) {
    if (!condition) {
        throw new FormatError(`Not a valid Roomy file: ${message}`);
    }
}

const isId = (value) => Number.isInteger(value) && value > 0;

function readVector(value, label) {
    check(value && typeof value === 'object', `${label} is missing`);
    for (const axis of AXES) {
        check(Number.isFinite(value[axis]), `${label} ${axis} is not a number`);
    }
    return { x: value.x, y: value.y, z: value.z };
}

// Validate saved data and turn it into the state Project.replace() takes.
// Throws an Error with a readable message for anything it cannot use.
export function deserialize(data) {
    check(data && typeof data === 'object', 'expected a JSON object');
    check(data.format === FORMAT, 'unknown file format');
    check(Number.isInteger(data.version), 'missing version');
    if (data.version > VERSION) {
        throw new FormatError('This file was saved by a newer version of Roomy');
    }
    check(typeof data.name === 'string', 'missing name');
    check(Object.hasOwn(UNITS, data.unit), `unknown unit "${data.unit}"`);
    check(Array.isArray(data.pieces) && Array.isArray(data.groups), 'missing pieces or groups');
    // Added after version 1 shipped; older files use the default sheet.
    const sheet = { ...DEFAULT_SHEET, ...data.sheet };
    try {
        validateSheet(sheet);
    } catch (err) {
        throw new FormatError(`Not a valid Roomy file: ${err.message}`);
    }

    const groups = data.groups.map((group, index) => {
        check(isId(group.id), `group ${index + 1} has no valid id`);
        check(typeof group.name === 'string', `group ${group.id} has no name`);
        check(group.parentId === null || isId(group.parentId), `group ${group.id} has a bad parent`);
        const rotation = readVector(group.rotation, `group ${group.id} rotation`);
        return {
            id: group.id,
            name: group.name,
            parentId: group.parentId,
            rotation: { x: normalizeAngle(rotation.x), y: normalizeAngle(rotation.y), z: normalizeAngle(rotation.z) },
        };
    });
    const groupIds = new Set(groups.map((group) => group.id));
    check(groupIds.size === groups.length, 'duplicate group ids');
    for (const group of groups) {
        check(group.parentId === null || groupIds.has(group.parentId), `group ${group.id} has a missing parent`);
        // Walk up the parents; seeing a group twice means a loop.
        const seen = new Set();
        for (let id = group.id; id !== null; id = groups.find((g) => g.id === id).parentId) {
            check(!seen.has(id), `group ${group.id} is inside itself`);
            seen.add(id);
        }
    }

    const pieces = data.pieces.map((piece, index) => {
        check(isId(piece.id), `piece ${index + 1} has no valid id`);
        check(typeof piece.name === 'string', `piece ${piece.id} has no name`);
        check(piece.groupId === null || groupIds.has(piece.groupId), `piece ${piece.id} is in a missing group`);
        const out = {
            id: piece.id,
            name: piece.name,
            ...Object.fromEntries(DIMENSIONS.map((dim) => [dim, piece[dim]])),
            position: readVector(piece.position, `piece ${piece.id} position`),
            rotation: readVector(piece.rotation, `piece ${piece.id} rotation`),
            groupId: piece.groupId,
        };
        try {
            validatePiece(out);
        } catch (err) {
            throw new FormatError(`Not a valid Roomy file: piece ${piece.id}: ${err.message}`);
        }
        for (const axisName of AXES) {
            out.rotation[axisName] = normalizeAngle(out.rotation[axisName]);
        }
        return out;
    });
    check(new Set(pieces.map((piece) => piece.id)).size === pieces.length, 'duplicate piece ids');

    // Never hand out an id that is already taken, whatever the file says.
    const maxId = (items) => items.reduce((max, item) => Math.max(max, item.id), 0);
    return {
        name: data.name,
        unit: data.unit,
        sheet,
        pieces,
        groups,
        nextPieceId: Math.max(isId(data.nextPieceId) ? data.nextPieceId : 1, maxId(pieces) + 1),
        nextGroupId: Math.max(isId(data.nextGroupId) ? data.nextGroupId : 1, maxId(groups) + 1),
    };
}

export function loadText(project, text, options) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new FormatError('Not a valid Roomy file: it is not JSON');
    }
    project.replace(deserialize(data), options);
}

// "My Shelf / v2" -> "my-shelf-v2.json"
export function fileName(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${slug || 'roomy-design'}.json`;
}

// Browser auto-save. `storage` is window.localStorage in the app; it can be
// missing or throw (private mode, blocked storage), so failures are ignored.
export function restoreAutosave(project, storage) {
    try {
        const text = storage && storage.getItem(AUTOSAVE_KEY);
        if (text) {
            loadText(project, text, { record: false });
            project.clearHistory();
            return true;
        }
    } catch {
        // Unreadable or invalid auto-save: start fresh rather than fail.
    }
    return false;
}

export function bindAutosave(project, storage, delay = 300) {
    let timer = null;
    const save = () => {
        timer = null;
        try {
            storage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize(project)));
        } catch {
            // Storage full or blocked; the JSON file is still available.
        }
    };
    project.onChange(() => {
        clearTimeout(timer);
        timer = setTimeout(save, delay);
    });
    return save;
}
