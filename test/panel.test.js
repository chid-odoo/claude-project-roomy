// @vitest-environment jsdom
// Drives the real side panel DOM. The 3D scene needs WebGL, so a stub
// stands in for it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Project } from '../src/model/project.js';
import { toMm } from '../src/model/units.js';
import { Panel } from '../src/ui/panel.js';

// jsdom has no PointerEvent or pointer capture.
if (!window.PointerEvent) {
    window.PointerEvent = class PointerEvent extends MouseEvent {
        constructor(type, init = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
            this.pointerType = init.pointerType ?? 'mouse';
        }
    };
}
Element.prototype.setPointerCapture ??= () => {};
// Nor Blob.text(), which every browser the app targets has.
Blob.prototype.text ??= function text() {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsText(this);
    });
};

let project;
let scene;
let panel;

function isShown(node) {
    for (let n = node; n; n = n.parentElement) {
        if (n.hidden) {
            return false;
        }
    }
    return true;
}

const shown = (selector) => [...document.querySelectorAll(selector)].filter(isShown);

const iconButton = (label) => shown('button.icon').find((b) => b.getAttribute('aria-label') === label);

function button(text) {
    const found = shown('button').find((b) => b.textContent === text);
    if (!found) {
        throw new Error(`No visible button "${text}"`);
    }
    return found;
}

// The input of the visible field labelled `label`; `index` picks among
// several (e.g. the box form and the piece editor both have "Width").
function input(label, index = 0) {
    const fields = shown('.field').filter((f) => f.firstChild.textContent === label);
    if (!fields[index]) {
        throw new Error(`No visible field "${label}" #${index}`);
    }
    return fields[index].querySelector('input, select');
}

function type(target, value) {
    target.value = value;
    target.dispatchEvent(new Event('change'));
}

const treeRows = () => shown('.tree .node').map((n) => n.textContent);
const errors = () => shown('.error').map((e) => e.textContent);
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function drag(target, dy, { pointerType = 'mouse', shiftKey = false } = {}) {
    const base = { bubbles: true, button: 0, pointerId: 5, pointerType, clientX: 10, clientY: 100 };
    target.dispatchEvent(new PointerEvent('pointerdown', base));
    for (let y = 0; y <= Math.abs(dy); y += 4) {
        target.dispatchEvent(new PointerEvent('pointermove', { ...base, shiftKey, clientY: 100 + Math.sign(dy) * y }));
    }
    target.dispatchEvent(new PointerEvent('pointerup', { ...base, clientY: 100 + dy }));
}

beforeEach(() => {
    window.location.hash = '';
    document.body.innerHTML = '<aside id="panel"></aside>';
    project = new Project({ unit: 'in' });
    scene = { frame: vi.fn(), multiSelect: false };
    panel = new Panel(document.getElementById('panel'), project, scene);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('new box form', () => {
    it('adds a box with the default size and frames it', () => {
        button('Add box').click();
        expect(project.pieces).toHaveLength(5);
        expect(project.pieces[0]).toMatchObject({ name: 'Front', width: toMm(24, 'in'), height: toMm(12, 'in') });
        expect(project.pieces[0].depth).toBeCloseTo(toMm(0.75, 'in'));
        expect(scene.frame).toHaveBeenCalled();
    });

    it('groups each new box as "Box N" and selects it', () => {
        button('Add box').click();
        button('Add box').click();
        expect(treeRows().filter((row) => row.startsWith('Box'))).toEqual(['Box 1 (5 pieces)', 'Box 2 (5 pieces)']);
        expect(shown('h2').map((h) => h.textContent)).toContain('Selected group');
        expect(input('Group name').value).toBe('Box 2');
    });

    it('uses typed sizes, a custom thickness and a closed top', () => {
        type(input('Width'), '30');
        type(input('Height'), '1\' 6"');
        type(input('Plywood thickness'), 'custom');
        type(input('Custom thickness'), '5/8');
        shown('.check input')[0].click();
        button('Add box').click();
        expect(project.pieces.map((p) => p.name)).toContain('Top');
        expect(project.pieces[0].width).toBeCloseTo(toMm(30, 'in'));
        expect(project.pieces[0].height).toBeCloseTo(toMm(18, 'in'));
        expect(project.pieces[0].depth).toBeCloseTo(toMm(0.625, 'in'));
    });

    it('shows an error for a box too small for its thickness', () => {
        type(input('Width'), '1');
        button('Add box').click();
        expect(project.pieces).toHaveLength(0);
        expect(errors()).toEqual(['Width and depth must be more than twice the thickness']);
    });

    it('marks text it cannot read and keeps the old value', () => {
        type(input('Width'), 'abc');
        expect(input('Width').classList.contains('invalid')).toBe(true);
        button('Add box').click();
        expect(project.pieces[0].width).toBe(toMm(24, 'in'));
    });
});

describe('piece editor', () => {
    beforeEach(() => {
        button('Add panel').click();
    });

    it('edits size, position and rotation of the selected piece', () => {
        type(input('Width', 1), '30 1/2');
        type(input('X'), '2\'');
        type(input('Rotate Y'), '450');
        const piece = project.pieces[0];
        expect(piece.width).toBeCloseTo(toMm(30.5, 'in'));
        expect(piece.position.x).toBeCloseTo(toMm(24, 'in'));
        expect(piece.rotation.y).toBe(90);
        expect(input('Rotate Y').value).toBe('90');
    });

    it('changes a size by dragging the field up', () => {
        drag(input('Width', 1), -40); // 10 steps of the default 1/4"
        expect(project.pieces[0].width).toBeCloseTo(toMm(26.5, 'in'));
    });

    it('drags the label with touch, but not the input', () => {
        const field = shown('.field').find((f) => f.firstChild.textContent === 'Rotate Z');
        drag(field.querySelector('input'), -40, { pointerType: 'touch' });
        expect(project.pieces[0].rotation.z).toBe(0);
        drag(field.querySelector('.scrub-handle'), -8, { pointerType: 'touch', shiftKey: true });
        expect(project.pieces[0].rotation.z).toBe(20);
    });

    it('moves with the +/- buttons by the chosen step', () => {
        type(input('Move step'), String(toMm(1, 'in')));
        shown('.move-row')[1].querySelectorAll('button')[1].click(); // Y +
        expect(project.pieces[0].position.y).toBeCloseTo(toMm(1, 'in'));
    });

    it('deletes the piece', () => {
        button('Delete').click();
        expect(project.pieces).toHaveLength(0);
        expect(treeRows()).toEqual([]);
    });
});

describe('selecting and grouping', () => {
    beforeEach(() => {
        button('Add panel').click();
        button('Add panel').click();
        button('Add panel').click();
    });

    it('selects with a click and adds with Shift+click', () => {
        shown('.tree .node')[0].click();
        shown('.tree .node')[1].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
        expect(project.selection).toEqual(['piece:1', 'piece:2']);
        expect(shown('h2').map((h) => h.textContent)).toContain('2 items selected');
    });

    it('adds with a plain click while "Select multiple" is ticked', () => {
        const toggle = shown('.check input').find((c) => c.parentElement.textContent.includes('Select multiple'));
        toggle.click();
        expect(scene.multiSelect).toBe(true);
        project.clearSelection();
        shown('.tree .node')[0].click();
        shown('.tree .node')[2].click();
        expect(project.selection).toEqual(['piece:1', 'piece:3']);
    });

    it('groups, renames, moves and ungroups from the panel', () => {
        project.select(['piece:1', 'piece:2']);
        button('Group').click();
        expect(treeRows()[0]).toBe('Group 1 (2 pieces)');

        type(input('Group name'), 'Shelf');
        expect(treeRows()[0]).toBe('Shelf (2 pieces)');

        type(input('Y'), '10');
        expect(project.pieces.map((p) => p.position.y)).toEqual([toMm(10, 'in'), toMm(10, 'in'), 0]);
        drag(input('X'), -4);
        expect(project.pieces[0].position.x).toBeCloseTo(toMm(0.25, 'in'));

        button('Ungroup').click();
        expect(project.groups).toEqual([]);
        expect(project.selection).toEqual(['piece:1', 'piece:2']);
    });

    it('only enables Group and Ungroup when they would do something', () => {
        shown('.tree .node')[0].click();
        expect(button('Group').disabled).toBe(true);
        expect(button('Ungroup').disabled).toBe(true);
    });
});

describe('undo and redo buttons', () => {
    it('are disabled until there is something to undo or redo', () => {
        expect(button('Undo').disabled).toBe(true);
        expect(button('Redo').disabled).toBe(true);
        button('Add box').click();
        expect(button('Undo').disabled).toBe(false);
        expect(button('Redo').disabled).toBe(true);
    });

    it('remove and bring back a whole box', () => {
        button('Add box').click();
        button('Undo').click();
        expect(project.pieces).toHaveLength(0);
        expect(treeRows()).toEqual([]);
        button('Redo').click();
        expect(treeRows()[0]).toBe('Box 1 (5 pieces)');
    });

    it('undo a whole field drag in one step', () => {
        button('Add panel').click();
        drag(input('Width', 1), -40);
        drag(input('Width', 1), -40);
        button('Undo').click();
        expect(project.pieces[0].width).toBeCloseTo(toMm(26.5, 'in'));
        expect(input('Width', 1).value).toBe('26 1/2"');
        button('Undo').click();
        expect(project.pieces[0].width).toBeCloseTo(toMm(24, 'in'));
    });

    it('undo opening a file', async () => {
        button('Add panel').click();
        const picker = document.querySelector('input[type=file]');
        const other = new Project();
        other.addPiece({ width: 1, height: 1, depth: 1, name: 'Tiny' });
        const { toJSONText } = await import('../src/model/storage.js');
        Object.defineProperty(picker, 'files', { value: [new File([toJSONText(other)], 'x.json')], configurable: true });
        picker.dispatchEvent(new Event('change'));
        await tick(50);
        expect(project.pieces[0].name).toBe('Tiny');
        button('Undo').click();
        expect(project.pieces[0].name).toBe('Piece 1');
    });
});

describe('duplicate', () => {
    it('copies the selected box next to it as "(copy)" and selects it', () => {
        button('Add box').click();
        button('Duplicate').click();
        expect(treeRows().filter((row) => row.startsWith('Box'))).toEqual(['Box 1 (5 pieces)', 'Box 1 (copy) (5 pieces)']);
        expect(input('Group name').value).toBe('Box 1 (copy)');
        button('Undo').click();
        expect(project.pieces).toHaveLength(5);
    });
});

describe('help', () => {
    it('opens from the ? icon on the design and on Settings, and goes back', async () => {
        iconButton('Help').click();
        await tick();
        expect(window.location.hash).toBe('#help');
        expect(shown('h1').map((h) => h.textContent)).toEqual(['Help']);
        const headings = shown('h2').map((h) => h.textContent);
        expect(headings).toEqual(expect.arrayContaining(['Getting started', 'Settings', 'Shortcuts']));
        expect(shown('.shortcuts th').map((th) => th.textContent)).toContain('Ctrl + D');

        button('< Back').click();
        await tick(50);
        expect(window.location.hash).toBe('');

        iconButton('Settings').click();
        await tick();
        iconButton('Help').click();
        await tick();
        expect(window.location.hash).toBe('#help');
        button('< Back').click();
        await tick(50);
        expect(window.location.hash).toBe('#settings');
    });

    it('shows the design when the address has an unknown #', async () => {
        window.location.hash = '#nope';
        await tick();
        expect(shown('h1')[0].textContent).toBe('Untitled');
    });
});

describe('sheets to buy', () => {
    // Read even while Settings hides the design view.
    const estimate = () => [...document.querySelectorAll('.estimate-line')].map((e) => e.textContent);

    it('prompts for pieces when there are none', () => {
        expect(shown('section').find((sec) => sec.querySelector('h2')?.textContent === 'Sheets to buy').textContent)
            .toContain('Add pieces to see how many sheets you need.');
    });

    it('estimates sheets for a box and draws each one with a numbered legend', () => {
        button('Add box').click();
        expect(estimate()).toEqual([expect.stringMatching(/^3\/4" plywood: 1 sheet of 4' x 8', \d+% used$/)]);
        const [diagram] = shown('svg.sheet-diagram');
        expect(diagram.getAttribute('viewBox')).toBe('0 0 2438.4 1219.2');
        expect(diagram.querySelectorAll('.sheet-piece')).toHaveLength(5);
        const legend = shown('.sheet-legend li').map((li) => li.textContent);
        expect(legend).toHaveLength(5);
        expect(legend.find((line) => line.startsWith('Front:'))).toMatch(/^Front: (24" x 12"|12" x 24")/);
    });

    it('updates when the sheet size and saw change in Settings', async () => {
        button('Add box').click();
        button('Add box').click();
        expect(estimate()[0]).toMatch(/1 sheet of 4' x 8'/);
        window.location.hash = '#settings';
        await tick();
        type(input('Sheet size'), '2'); // 2' x 4'
        expect(project.sheet.length).toBeCloseTo(toMm(48, 'in'));
        expect(project.sheet.width).toBeCloseTo(toMm(24, 'in'));
        expect(estimate()[0]).toMatch(/: [3-9] sheets of 2' x 4'/);

        type(input('Sheet size'), 'custom');
        type(input('Length'), '50');
        type(input('Width'), '30');
        expect(project.sheet.length).toBeCloseTo(toMm(50, 'in'));
        expect(project.sheet.width).toBeCloseTo(toMm(30, 'in'));
        expect(estimate()[0]).toMatch(/sheets of 30" x 50"/);

        type(input('Saw kerf (blade width)'), '3/32');
        shown('.check input').find((c) => c.parentElement.textContent.includes('Allow rotating')).click();
        expect(project.sheet.kerf).toBeCloseTo(toMm(3 / 32, 'in'));
        expect(project.sheet.allowRotate).toBe(false);
    });

    it('flags pieces too big for the sheet', () => {
        button('Add panel').click();
        type(input('Width', 1), '100');
        expect(errors()).toEqual(['Too big for a 4\' x 8\' sheet: Piece 1 (100" x 24")']);
    });

    it('shows a separate estimate for each thickness', () => {
        button('Add panel').click();
        button('Add panel').click();
        type(input('Depth', 1), '1/4');
        expect(estimate().map((line) => line.split(':')[0])).toEqual(['1/4" plywood', '3/4" plywood']);
    });
});

describe('settings', () => {
    it('opens from the gear, changes units and goes back', async () => {
        button('Add panel').click();
        iconButton('Settings').click();
        await tick();
        expect(window.location.hash).toBe('#settings');
        expect(shown('h1').map((h) => h.textContent)).toEqual(['Settings']);

        type(input('Units'), 'mm');
        button('< Back').click();
        await tick(50); // jsdom runs history.back() asynchronously
        expect(window.location.hash).toBe('');
        expect(treeRows()[0]).toBe('Piece 1: 609.6 mm x 609.6 mm x 19.1 mm');
    });
});

describe('file', () => {
    it('saves the design as a named JSON download', async () => {
        let saved = null;
        URL.createObjectURL = vi.fn((blob) => {
            saved = blob;
            return 'blob:test';
        });
        URL.revokeObjectURL = vi.fn();
        const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
            expect(this.download).toBe('toy-chest.json');
        });
        button('Add box').click();
        type(input('Design name'), 'Toy chest');
        button('Save').click();
        expect(clicks).toHaveBeenCalledTimes(1);
        const data = JSON.parse(await saved.text());
        expect(data).toMatchObject({ format: 'roomy-project', name: 'Toy chest' });
        expect(data.pieces).toHaveLength(5);
    });

    async function open(text) {
        const picker = document.querySelector('input[type=file]');
        Object.defineProperty(picker, 'files', { value: [new File([text], 'design.json')], configurable: true });
        picker.dispatchEvent(new Event('change'));
        await tick(50);
    }

    it('opens a file in place of the current design', async () => {
        const other = new Project({ unit: 'cm', name: 'Shared' });
        other.addPiece({ width: 100, height: 200, depth: 18, name: 'Door' });
        const { toJSONText } = await import('../src/model/storage.js');
        button('Add box').click();
        await open(toJSONText(other));
        expect(project.pieces.map((p) => p.name)).toEqual(['Door']);
        expect(shown('h1')[0].textContent).toBe('Shared');
        expect(scene.frame).toHaveBeenCalled();
    });

    it('keeps the design and shows why when a file is not valid', async () => {
        button('Add panel').click();
        await open('{"hello": 1}');
        expect(project.pieces).toHaveLength(1);
        expect(errors()).toEqual(['Not a valid Roomy file: unknown file format']);
    });

    it('starts a new design after confirming', () => {
        button('Add panel').click();
        vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        button('New').click();
        expect(project.pieces).toHaveLength(1);
        button('New').click();
        expect(project.pieces).toHaveLength(0);
        expect(project.name).toBe('Untitled');
    });
});
