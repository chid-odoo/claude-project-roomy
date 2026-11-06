// Mouse/touch picking and keyboard shortcuts, kept free of DOM and Three.js
// specifics so the rules can be tested on their own.
import { pieceKey } from '../model/project.js';

// A click on a piece selects its outermost group; a double click selects the
// piece itself. `additive` (Shift or the "select multiple" toggle) adds to or
// removes from the selection instead of replacing it. `pieceId` is null when
// the click hit nothing.
export function pickPiece(project, pieceId, { additive = false, double = false } = {}) {
    if (pieceId === null) {
        if (!additive) {
            project.clearSelection();
        }
        return;
    }
    const outer = project.topLevelKey(pieceId);
    if (!double) {
        if (additive) {
            project.toggle(outer);
        } else {
            project.select([outer]);
        }
        return;
    }
    if (!additive) {
        project.select([pieceKey(pieceId)]);
        return;
    }
    // The first click of the pair toggled the outer group: undo that, then
    // toggle the piece.
    project.toggle(outer);
    project.toggle(pieceKey(pieceId));
}

// Left/Right: X. Up/Down: Z (away from / toward the default camera).
// Shift+Up/Down: Y. Ctrl/Cmd+G: group, Ctrl/Cmd+Shift+G: ungroup.
// Ctrl/Cmd+Z: undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y: redo. Ctrl/Cmd+D: duplicate.
export function keyAction({ key, shiftKey = false, ctrlKey = false, metaKey = false, altKey = false }) {
    if (ctrlKey || metaKey) {
        if (altKey) {
            return null;
        }
        switch (key.toLowerCase()) {
            case 'g':
                return { type: shiftKey ? 'ungroup' : 'group' };
            case 'z':
                return { type: shiftKey ? 'redo' : 'undo' };
            case 'y':
                return shiftKey ? null : { type: 'redo' };
            case 'd':
                return shiftKey ? null : { type: 'duplicate' };
            default:
                return null;
        }
    }
    if (altKey) {
        return null;
    }
    switch (key) {
        case 'ArrowLeft':
            return shiftKey ? null : { type: 'move', axis: 'x', direction: -1 };
        case 'ArrowRight':
            return shiftKey ? null : { type: 'move', axis: 'x', direction: 1 };
        case 'ArrowUp':
            return shiftKey ? { type: 'move', axis: 'y', direction: 1 } : { type: 'move', axis: 'z', direction: -1 };
        case 'ArrowDown':
            return shiftKey ? { type: 'move', axis: 'y', direction: -1 } : { type: 'move', axis: 'z', direction: 1 };
        default:
            return null;
    }
}

// Run a keyAction against the project. Returns false when there was nothing
// to do, so the browser's default for the key is kept.
export function applyKeyAction(project, action, step) {
    if (!action) {
        return false;
    }
    if (action.type === 'undo') {
        return project.undo();
    }
    if (action.type === 'redo') {
        return project.redo();
    }
    if (!project.selection.length) {
        return false;
    }
    if (action.type === 'move') {
        project.moveSelection({ [action.axis]: action.direction * step });
        return true;
    }
    if (action.type === 'group') {
        if (project.selection.length < 2) {
            return false;
        }
        project.group();
        return true;
    }
    if (action.type === 'duplicate') {
        project.duplicate();
        return true;
    }
    if (action.type === 'ungroup') {
        project.ungroup();
        return true;
    }
    return false;
}

const EDITABLE = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

// Inside text fields the browser's own shortcuts (including Ctrl+Z for the
// field's text) are left alone.
export function bindKeyboard(target, project, getStep) {
    // Holding an arrow key repeats keydown; batch those into one undo step.
    let nudging = false;
    const stopNudging = () => {
        if (nudging) {
            nudging = false;
            project.endBatch();
        }
    };
    target.addEventListener('keydown', (ev) => {
        if (EDITABLE.has(ev.target.tagName) || ev.target.isContentEditable) {
            return;
        }
        const action = keyAction(ev);
        if (action && action.type === 'move') {
            if (!ev.repeat) {
                stopNudging();
            }
            if (!nudging) {
                nudging = true;
                project.beginBatch();
            }
        } else {
            stopNudging();
        }
        if (applyKeyAction(project, action, getStep())) {
            ev.preventDefault();
        }
    });
    target.addEventListener('keyup', (ev) => {
        if (ev.key.startsWith('Arrow')) {
            stopNudging();
        }
    });
    target.addEventListener('blur', stopNudging);
}
