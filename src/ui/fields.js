// Shared building blocks for the side panel: a tiny DOM helper and the
// number field used for every length and angle.
import { formatInput, parseLength } from '../model/units.js';
import { makeScrubbable } from './scrub.js';

const ANGLE_STEP = 1; // degrees per scrub step

export function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

function parseAngle(text) {
    const match = /^\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:deg)?\s*$/i.exec(text);
    return match ? parseFloat(match[1]) : NaN;
}

// A text field holding a number, typed as text so lengths can use fractions
// like 1 1/2. Drag up/down on the field (mouse) or its label (any pointer,
// including touch) to change the value; see scrub.js.
//   kind 'length': value in mm, shown in the project unit, steps by `getStep()`
//   kind 'angle': value in degrees, steps by 1
export class NumberField {
    constructor(label, project, onCommit, { kind = 'length', getStep, min } = {}) {
        this.project = project;
        this.kind = kind;
        this.value = 0;
        this.onCommit = onCommit;
        this.input = el('input', {
            type: 'text',
            inputMode: kind === 'angle' ? 'decimal' : 'text',
            autocomplete: 'off',
            spellcheck: false,
            className: 'scrub',
        });
        this.input.setAttribute('aria-label', label);
        this.input.addEventListener('change', () => {
            const value = kind === 'angle' ? parseAngle(this.input.value) : parseLength(this.input.value, project.unit);
            if (!Number.isFinite(value)) {
                this.fail(kind === 'angle' ? 'Could not read this angle' : 'Could not read this length');
                return;
            }
            this.commit(value);
        });

        const scrub = {
            getValue: () => this.value,
            setValue: (value) => this.commit(value),
            getStep: kind === 'angle' ? () => ANGLE_STEP : getStep,
            min,
            onStart: () => project.beginBatch(),
            onEnd: () => project.endBatch(),
        };
        // On the input, a mouse press that doesn't drag focuses it for typing;
        // stop the browser focusing (and selecting text) on press so a drag
        // doesn't leave the field in edit mode.
        let pointerType = 'mouse';
        this.input.addEventListener('pointerdown', (ev) => {
            pointerType = ev.pointerType;
        });
        this.input.addEventListener('mousedown', (ev) => {
            if (pointerType !== 'touch' && document.activeElement !== this.input) {
                ev.preventDefault();
            }
        });
        makeScrubbable(this.input, {
            ...scrub,
            onClick: () => {
                if (document.activeElement !== this.input) {
                    this.input.focus();
                    this.input.select();
                }
            },
        });
        this.handle = el('span', { className: 'scrub-handle', textContent: label });
        makeScrubbable(this.handle, { ...scrub, touch: true, onClick: () => this.input.focus() });
        this.root = el('div', { className: 'field' }, [this.handle, this.input]);
    }

    setLabel(label) {
        if (this.handle.textContent !== label) {
            this.handle.textContent = label;
            this.input.setAttribute('aria-label', label);
        }
    }

    commit(value) {
        this.value = value;
        this.clear();
        this.onCommit(value);
        this.render();
    }

    set(value) {
        this.value = value;
        this.clear();
        this.render();
    }

    render() {
        if (this.kind === 'angle') {
            this.input.value = String(Math.round(this.value * 10) / 10);
        } else {
            this.input.value = formatInput(this.value, this.project.unit);
        }
    }

    fail(message) {
        this.input.classList.add('invalid');
        this.input.title = message;
    }

    clear() {
        this.input.classList.remove('invalid');
        this.input.title = '';
    }
}
