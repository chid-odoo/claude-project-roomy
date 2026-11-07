import { createBox } from '../model/box.js';
import { buildCutList } from '../model/cutlist.js';
import { AXES, DIMENSION_OF_AXIS, DIMENSIONS, parseKey, pieceKey } from '../model/project.js';
import { formatLength, MOVE_STEPS, moveSteps, THICKNESS_PRESETS, toMm, UNITS } from '../model/units.js';
import { estimateSheets, SHEET_PRESETS } from '../model/sheets.js';
import { fileName, loadText, toJSONText } from '../model/storage.js';
import { bounds } from '../view/transform.js';
import { buildHelp } from './help.js';
import { THEMES } from './appearance.js';
import { el, NumberField } from './fields.js';
import { DESKTOP_QUERY, Inspector } from './inspector.js';
import { sheetDiagram, sizeText } from './sheetDiagram.js';

const GAP = 50; // mm between a new item and what is already there
const MIN_SIZE = 1; // mm; dragging a size field stops here
const LOW_EDGE = { x: 'left', y: 'bottom', z: 'back' }; // where split lengths are measured from
const capitalize = (word) => word[0].toUpperCase() + word.slice(1);
const SETTINGS_HASH = '#settings';
const HELP_HASH = '#help';
const SVG_NS = 'http://www.w3.org/2000/svg';

// A gear outline: 8 teeth around a ring with a hole, drawn in a 24x24 box.
function gearIcon() {
    const teeth = 8;
    const points = [];
    for (let i = 0; i < teeth * 4; i++) {
        const angle = (i / (teeth * 4)) * Math.PI * 2;
        const radius = i % 4 < 2 ? 10.5 : 8;
        points.push(`${(12 + radius * Math.cos(angle)).toFixed(2)},${(12 + radius * Math.sin(angle)).toFixed(2)}`);
    }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const gear = document.createElementNS(SVG_NS, 'path');
    // Even-odd fill cuts the centre hole out of the toothed ring.
    gear.setAttribute('d', `M${points.join('L')}Z M15.5,12 A3.5,3.5 0 1 0 8.5,12 A3.5,3.5 0 1 0 15.5,12 Z`);
    gear.setAttribute('fill-rule', 'evenodd');
    svg.append(gear);
    return svg;
}

export class Panel {
    // `appearance` (theme and shadows, see appearance.js) is optional; without
    // it Settings has no Appearance section.
    constructor(root, project, scene, { appearance = null } = {}) {
        this.appearance = appearance;
        this.root = root;
        this.project = project;
        this.scene = scene;
        this.fields = [];

        this.mainView = el('div', { className: 'view' }, [
            this._buildHeader(),
            this._buildFile(),
            this._buildBoxForm(),
            this._buildPieceList(),
            this._buildEditor(),
            this._buildCutList(),
            this._buildEstimate(),
        ]);
        this.views = {
            '': this.mainView,
            [SETTINGS_HASH]: el('div', { className: 'view' }, [this._buildSettings()]),
            [HELP_HASH]: el('div', { className: 'view' }, [this._buildHelp()]),
        };
        // The views scroll inside the panel; the expand handle stays put on its edge.
        this.scrollArea = el('div', { className: 'panel-scroll' }, Object.values(this.views));
        this.layout = root.parentElement;
        this.expanded = false;
        root.append(this._buildExpandHandle(), this.scrollArea);
        // Without a 3D view (e.g. in tests) everything stays in the panel.
        this.inspector = scene.container
            ? new Inspector(scene.container, [
                this.sizeBlock, this.selSizeBlock, this.posBlock, this.selPosBlock, this.rotBlock, this.groupRotBlock,
            ])
            : null;
        window.addEventListener('hashchange', () => {
            // Mark entries opened from inside the app, so Back can pop them.
            if (window.location.hash && !window.history.state) {
                window.history.replaceState({ inApp: true }, '');
            }
            this._showView();
        });
        this._showView();
        project.onChange(() => this.render());
        this.render();
    }

    // Settings and Help are other views of the panel at #settings and #help,
    // so the browser's back button works with them.
    _showView() {
        const hash = Object.hasOwn(this.views, window.location.hash) ? window.location.hash : '';
        for (const [key, view] of Object.entries(this.views)) {
            view.hidden = key !== hash;
        }
        this.scrollArea.scrollTop = 0;
    }

    // The tab halfway down the panel's edge (top edge on phones) that pulls
    // the panel out over the whole window, e.g. to read the cut list and
    // sheet diagrams in comfort. Esc puts it back. Always starts collapsed.
    _buildExpandHandle() {
        const chevron = document.createElementNS(SVG_NS, 'svg');
        chevron.setAttribute('viewBox', '0 0 24 24');
        chevron.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', 'M15 5 L8 12 L15 19'); // points left: "pull this way"
        chevron.append(path);
        this.expandHandle = el('button', { type: 'button', className: 'panel-handle' }, [chevron]);
        this.expandHandle.addEventListener('click', () => this.setExpanded(!this.expanded));
        window.addEventListener('keydown', (ev) => {
            // While measuring, Esc belongs to the measure tool.
            if (ev.key === 'Escape' && this.expanded && !this.scene.measuring) {
                this.setExpanded(false);
                ev.preventDefault();
            }
        });
        this._labelExpandHandle();
        return this.expandHandle;
    }

    _wide() {
        return Boolean(window.matchMedia && window.matchMedia(DESKTOP_QUERY).matches);
    }

    setExpanded(on) {
        this.expanded = on;
        if (this.layout) {
            this.layout.classList.toggle('panel-expanded', on);
        }
        this._labelExpandHandle();
        this._renderEstimate();
    }

    _labelExpandHandle() {
        const label = this.expanded ? 'Collapse panel' : 'Expand panel to full screen';
        this.expandHandle.setAttribute('aria-label', label);
        this.expandHandle.setAttribute('aria-expanded', String(this.expanded));
        this.expandHandle.title = `${label}${this.expanded ? ' (Esc)' : ''}`;
    }

    _backButton() {
        const back = el('button', { type: 'button', className: 'secondary', textContent: '< Back' });
        back.addEventListener('click', () => {
            if (window.history.state && window.history.state.inApp) {
                window.history.back();
            } else {
                window.history.pushState(null, '', window.location.pathname + window.location.search);
                this._showView();
            }
        });
        return back;
    }

    _helpButton() {
        const help = el('button', { type: 'button', className: 'icon help-icon', title: 'Help', textContent: '?' });
        help.setAttribute('aria-label', 'Help');
        help.addEventListener('click', () => {
            window.location.hash = HELP_HASH;
        });
        return help;
    }

    _buildHelp() {
        return el('div', {}, [
            el('header', { className: 'panel-header' }, [el('h1', { textContent: 'Help' }), this._backButton()]),
            buildHelp(),
        ]);
    }

    _buildHeader() {
        this.title = el('h1');
        const gear = el('button', { type: 'button', className: 'icon', title: 'Settings' }, [gearIcon()]);
        gear.setAttribute('aria-label', 'Settings');
        gear.addEventListener('click', () => {
            window.location.hash = SETTINGS_HASH;
        });
        this.undoButton = el('button', { type: 'button', className: 'secondary small', textContent: 'Undo', title: 'Ctrl+Z' });
        this.undoButton.addEventListener('click', () => this.project.undo());
        this.redoButton = el('button', { type: 'button', className: 'secondary small', textContent: 'Redo', title: 'Ctrl+Shift+Z' });
        this.redoButton.addEventListener('click', () => this.project.redo());
        return el('header', { className: 'panel-header' }, [
            this.title,
            el('div', { className: 'header-actions' }, [this.undoButton, this.redoButton, this._helpButton(), gear]),
        ]);
    }

    _buildSettings() {
        return el('div', {}, [
            el('header', { className: 'panel-header' }, [
                el('h1', { textContent: 'Settings' }),
                el('div', { className: 'header-actions' }, [this._helpButton(), this._backButton()]),
            ]),
            ...(this.appearance ? [this._buildAppearance()] : []),
            this._buildUnits(),
            this._buildSheetSettings(),
        ]);
    }

    _buildFile() {
        const name = el('input', { type: 'text' });
        name.addEventListener('change', () => this.project.setName(name.value.trim() || 'Untitled'));
        this.nameField = name;

        const message = el('p', { className: 'error', hidden: true });
        const showError = (text) => {
            message.textContent = text;
            message.hidden = !text;
        };

        const save = el('button', { type: 'button', textContent: 'Save' });
        save.addEventListener('click', () => {
            const blob = new Blob([toJSONText(this.project)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = el('a', { href: url, download: fileName(this.project.name) });
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showError('');
        });

        const picker = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
        picker.addEventListener('change', async () => {
            const [file] = picker.files;
            picker.value = '';
            if (!file) {
                return;
            }
            try {
                loadText(this.project, await file.text());
                this.scene.frame();
                showError('');
            } catch (err) {
                showError(err.message);
            }
        });
        const open = el('button', { type: 'button', className: 'secondary', textContent: 'Open' });
        open.addEventListener('click', () => picker.click());

        const reset = el('button', { type: 'button', className: 'secondary', textContent: 'New' });
        reset.addEventListener('click', () => {
            if (this.project.pieces.length && !window.confirm('Start a new design? Save first if you want to keep this one.')) {
                return;
            }
            this.project.replace({
                name: 'Untitled', unit: this.project.unit, pieces: [], groups: [], nextPieceId: 1, nextGroupId: 1,
            });
            showError('');
        });

        return el('section', {}, [
            el('label', { className: 'field' }, [el('span', { textContent: 'Design name' }), name]),
            el('div', { className: 'actions' }, [save, open, reset, picker]),
            el('p', { className: 'hint', textContent: 'Saves a .json file you can share. Your work is also kept in this browser.' }),
            message,
        ]);
    }

    _field(label, onCommit = () => {}, options = {}) {
        const field = new NumberField(label, this.project, onCommit, { getStep: () => this.step, ...options });
        this.fields.push(field);
        return field;
    }

    _buildAppearance() {
        const { appearance } = this;
        const theme = el('select', {}, Object.entries(THEMES).map(([value, text]) => el('option', { value, textContent: text })));
        theme.value = appearance.theme;
        theme.addEventListener('change', () => appearance.setTheme(theme.value));
        const shadows = el('input', { type: 'checkbox', checked: appearance.shadows });
        shadows.addEventListener('change', () => appearance.setShadows(shadows.checked));
        appearance.onChange(() => {
            theme.value = appearance.theme;
            shadows.checked = appearance.shadows;
        });
        return el('section', {}, [
            el('h2', { textContent: 'Appearance' }),
            el('label', { className: 'field' }, [el('span', { textContent: 'Theme' }), theme]),
            el('p', { className: 'hint', textContent: 'Match device follows your computer or phone\'s dark mode.' }),
            el('label', { className: 'check' }, [shadows, ' Soft shadows']),
            el('p', { className: 'hint', textContent: 'The lamp casts shadows on the floor. Turn off if the 3D view feels slow.' }),
        ]);
    }

    _buildUnits() {
        const select = el('select', {}, Object.entries(UNITS).map(([key, def]) => el('option', { value: key, textContent: def.label })));
        select.value = this.project.unit;
        select.addEventListener('change', () => this.project.setUnit(select.value));
        this.unitSelect = select;
        return el('section', {}, [el('label', { className: 'field' }, [el('span', { textContent: 'Units' }), select])]);
    }

    _buildSheetSettings() {
        const setSheet = (changes) => {
            try {
                this.project.setSheet(changes);
                this.sheetError.hidden = true;
            } catch (err) {
                this.sheetError.textContent = err.message;
                this.sheetError.hidden = false;
                this.render();
            }
        };
        this.sheetPreset = el('select', {}, [
            ...SHEET_PRESETS.map((preset, index) => el('option', { value: String(index), textContent: preset.label })),
            el('option', { value: 'custom', textContent: 'Custom...' }),
        ]);
        this.customSheetChosen = false;
        this.sheetPreset.addEventListener('change', () => {
            this.customSheetChosen = this.sheetPreset.value === 'custom';
            if (this.customSheetChosen) {
                this.render();
            } else {
                const preset = SHEET_PRESETS[Number(this.sheetPreset.value)];
                setSheet({ length: preset.length, width: preset.width });
            }
        });
        this.sheetLength = this._field('Length', (mm) => setSheet({ length: mm }), { min: MIN_SIZE });
        this.sheetWidth = this._field('Width', (mm) => setSheet({ width: mm }), { min: MIN_SIZE });
        this.customSheet = el('div', { className: 'row' }, [this.sheetLength.root, this.sheetWidth.root]);
        this.kerfField = this._field('Saw kerf (blade width)', (mm) => setSheet({ kerf: mm }), { min: 0 });
        this.rotateCheck = el('input', { type: 'checkbox' });
        this.rotateCheck.addEventListener('change', () => setSheet({ allowRotate: this.rotateCheck.checked }));
        this.sheetError = el('p', { className: 'error', hidden: true });
        return el('section', {}, [
            el('h2', { textContent: 'Plywood sheets' }),
            el('p', { className: 'hint', textContent: 'Used for the "Sheets to buy" estimate under the cut list.' }),
            el('label', { className: 'field' }, [el('span', { textContent: 'Sheet size' }), this.sheetPreset]),
            this.customSheet,
            this.kerfField.root,
            el('p', { className: 'hint', textContent: 'Left between pieces for the saw blade. 1/8" suits most blades; thin-kerf blades are about 3/32".' }),
            el('label', { className: 'check' }, [this.rotateCheck, ' Allow rotating pieces']),
            el('p', {
                className: 'hint',
                textContent: 'Lets the layout turn a piece across the grain to fit more on a sheet. '
                    + 'Turn off when the grain must run the same way on every piece.',
            }),
            this.sheetError,
        ]);
    }

    _buildBoxForm() {
        const width = this._field('Width', undefined, { min: MIN_SIZE });
        const height = this._field('Height', undefined, { min: MIN_SIZE });
        const depth = this._field('Depth', undefined, { min: MIN_SIZE });
        width.set(toMm(24, 'in'));
        height.set(toMm(12, 'in'));
        depth.set(toMm(16, 'in'));

        const thickness = this._field('Custom thickness', undefined, { min: MIN_SIZE });
        const preset = el('select', {}, [
            ...THICKNESS_PRESETS.map((p, index) => el('option', { value: String(index), textContent: p.label })),
            el('option', { value: 'custom', textContent: 'Custom...' }),
        ]);
        const applyPreset = () => {
            thickness.root.hidden = preset.value !== 'custom';
            if (preset.value !== 'custom') {
                thickness.set(THICKNESS_PRESETS[preset.value].mm);
            }
        };
        preset.value = String(THICKNESS_PRESETS.findIndex((p) => p.label === '3/4"'));
        preset.addEventListener('change', applyPreset);
        applyPreset();

        const closed = el('input', { type: 'checkbox' });
        const error = el('p', { className: 'error', hidden: true });
        const add = el('button', { type: 'button', textContent: 'Add box' });
        add.addEventListener('click', () => {
            const box = bounds(this.project.pieces);
            try {
                const pieces = createBox({
                    width: width.value,
                    height: height.value,
                    depth: depth.value,
                    thickness: thickness.value,
                    closed: closed.checked,
                    origin: { x: box ? box.max.x + GAP : 0 },
                });
                error.hidden = true;
                this.project.addBox(pieces);
                this.scene.frame();
            } catch (err) {
                error.textContent = err.message;
                error.hidden = false;
            }
        });

        return el('section', {}, [
            el('h2', { textContent: 'New box' }),
            el('p', { className: 'hint', textContent: 'Outside dimensions. Panels are butt-jointed.' }),
            el('div', { className: 'row' }, [width.root, height.root, depth.root]),
            el('label', { className: 'field' }, [el('span', { textContent: 'Plywood thickness' }), preset]),
            thickness.root,
            el('label', { className: 'check' }, [closed, ' Closed top']),
            error,
            add,
        ]);
    }

    _buildPieceList() {
        this.tree = el('ul', { className: 'tree' });
        this.multiSelect = el('input', { type: 'checkbox' });
        this.multiSelect.addEventListener('change', () => {
            this.scene.multiSelect = this.multiSelect.checked;
        });
        const addPanel = el('button', { type: 'button', className: 'secondary', textContent: 'Add panel' });
        addPanel.addEventListener('click', () => {
            const box = bounds(this.project.pieces);
            const piece = this.project.addPiece({
                width: toMm(24, 'in'),
                height: toMm(24, 'in'),
                depth: toMm(0.75, 'in'),
                position: { x: box ? box.max.x + GAP : 0 },
            });
            this.project.select([pieceKey(piece.id)]);
            this.scene.frame();
        });
        return el('section', {}, [
            el('h2', { textContent: 'Pieces' }),
            el('label', { className: 'check' }, [this.multiSelect, ' Select multiple (or hold Shift)']),
            this.tree,
            addPanel,
        ]);
    }

    _buildEditor() {
        const update = (changes) => {
            try {
                this.project.updatePiece(this.project.selectedPiece.id, changes);
            } catch (err) {
                this.render();
                this.editorError.textContent = err.message;
                this.editorError.hidden = false;
            }
        };
        this.editorTitle = el('h2');
        this.editorError = el('p', { className: 'error', hidden: true });

        // Single group: rename it.
        this.groupNameInput = el('input', { type: 'text' });
        this.groupNameInput.addEventListener('change', () => {
            const group = this.project.selectedGroup;
            this.project.renameGroup(group.id, this.groupNameInput.value.trim() || group.name);
        });
        this.groupRotFields = Object.fromEntries(AXES.map((axis) => [
            axis,
            this._field(`Rotate ${axis.toUpperCase()}`, (deg) => {
                this.project.rotateGroup(this.project.selectedGroup.id, { [axis]: deg });
            }, { kind: 'angle' }),
        ]));
        this.groupRotBlock = this._block('Rotate', 'Rotation in degrees, about the centre of the group',
            AXES.map((axis) => this.groupRotFields[axis].root));
        this.groupFields = el('div', {}, [
            el('label', { className: 'field' }, [el('span', { textContent: 'Group name' }), this.groupNameInput]),
            this.groupRotBlock,
        ]);

        // Single piece: name, size and position.
        this.nameInput = el('input', { type: 'text' });
        this.nameInput.addEventListener('change', () => update({ name: this.nameInput.value.trim() || 'Piece' }));
        this.dimFields = Object.fromEntries(DIMENSIONS.map((dim) => [
            dim,
            this._field(dim[0].toUpperCase() + dim.slice(1), (mm) => update({ [dim]: mm }), { min: MIN_SIZE }),
        ]));
        this.posFields = Object.fromEntries(AXES.map((axis) => [
            axis,
            this._field(axis.toUpperCase(), (mm) => update({ position: { [axis]: mm } })),
        ]));
        this.rotFields = Object.fromEntries(AXES.map((axis) => [
            axis,
            this._field(`Rotate ${axis.toUpperCase()}`, (deg) => update({ rotation: { [axis]: deg } }), { kind: 'angle' }),
        ]));
        this.sizeBlock = this._block('Size', '', DIMENSIONS.map((dim) => this.dimFields[dim].root));
        this.posBlock = this._block('Position', 'Position of the corner nearest the origin, before rotation',
            AXES.map((axis) => this.posFields[axis].root));
        this.rotBlock = this._block('Rotate', 'Rotation in degrees, about the centre of the piece',
            AXES.map((axis) => this.rotFields[axis].root));
        this.pieceFields = el('div', {}, [
            el('label', { className: 'field' }, [el('span', { textContent: 'Name' }), this.nameInput]),
            this.sizeBlock,
            this.posBlock,
            this.rotBlock,
            el('p', { className: 'hint', textContent: 'Drag a field or its label up or down to change it (Shift: faster, Alt: finer).' }),
            this._buildSplit(),
        ]);

        // Group or several items: overall size and position. Changing a
        // position moves everything selected together.
        this.overall = el('p', { className: 'overall' });
        this.selPosFields = Object.fromEntries(AXES.map((axis) => [
            axis,
            this._field(axis.toUpperCase(), (mm) => this.project.moveSelectionTo(axis, mm)),
        ]));
        this.selSizeBlock = el('div', { className: 'transform-block' }, [
            el('span', { className: 'block-title', textContent: 'Size' }),
            this.overall,
        ]);
        this.selPosBlock = this._block('Position', 'Position of the selection\'s corner nearest the origin',
            AXES.map((axis) => this.selPosFields[axis].root));
        this.selectionFields = el('div', {}, [this.selSizeBlock, this.selPosBlock]);

        this.editor = el('section', { hidden: true }, [
            this.editorTitle,
            this.groupFields,
            this.pieceFields,
            this.selectionFields,
            this.editorError,
            this._buildMoveControls(),
            this._buildActions(),
        ]);
        return this.editor;
    }

    // "Split into two": cut the selected piece across its width, height or
    // depth. While open, the cut is previewed in the 3D view.
    _buildSplit() {
        this.splitState = null; // { pieceId, axis, at }
        this.splitAxis = el('select');
        this.splitAxis.addEventListener('change', () => {
            const piece = this.project.selectedPiece;
            const axis = this.splitAxis.value;
            this.splitState = { pieceId: piece.id, axis, at: piece[DIMENSION_OF_AXIS[axis]] / 2 };
            this._renderSplit();
        });
        this.splitAt = this._field('First piece', (mm) => {
            this.splitState.at = mm;
            this._renderSplit();
        }, { min: MIN_SIZE });
        this.splitRest = el('p', { className: 'overall' });
        this.splitError = el('p', { className: 'error', hidden: true });
        const halve = el('button', { type: 'button', className: 'secondary', textContent: 'Halve' });
        halve.addEventListener('click', () => {
            const piece = this.project.selectedPiece;
            this.splitState.at = piece[DIMENSION_OF_AXIS[this.splitState.axis]] / 2;
            this._renderSplit();
        });
        const split = el('button', { type: 'button', textContent: 'Split' });
        split.addEventListener('click', () => {
            const { pieceId, axis, at } = this.splitState;
            try {
                this.project.splitPiece(pieceId, axis, at);
                this.splitDetails.open = false;
                this.splitError.hidden = true;
            } catch (err) {
                this.splitError.textContent = err.message;
                this.splitError.hidden = false;
            }
        });
        this.splitDetails = el('details', { className: 'split' }, [
            el('summary', { textContent: 'Split into two' }),
            el('label', { className: 'field' }, [el('span', { textContent: 'Cut across' }), this.splitAxis]),
            this.splitAt.root,
            this.splitRest,
            el('div', { className: 'actions' }, [halve, split]),
            el('p', { className: 'hint', textContent: 'The cut has no width here; the saw kerf is only allowed for in Sheets to buy.' }),
            this.splitError,
        ]);
        // Opening starts fresh: across the longest side, halfway.
        this.splitDetails.addEventListener('toggle', () => {
            if (this.splitDetails.open) {
                this.splitState = null;
            }
            this._renderSplit();
        });
        return this.splitDetails;
    }

    // Cut across one of the piece's two biggest dimensions (never its
    // thickness), halfway along by default.
    _renderSplit() {
        const piece = this.project.selectedPiece;
        if (!piece) {
            this.splitState = null;
            this.scene.setSplitPreview(null);
            return;
        }
        const { unit } = this.project;
        const axes = [...AXES].sort((a, b) => piece[DIMENSION_OF_AXIS[b]] - piece[DIMENSION_OF_AXIS[a]]).slice(0, 2);
        const state = this.splitState;
        if (!state || state.pieceId !== piece.id || !axes.includes(state.axis)) {
            this.splitState = { pieceId: piece.id, axis: axes[0], at: piece[DIMENSION_OF_AXIS[axes[0]]] / 2 };
            this.splitError.hidden = true;
        }
        const { axis } = this.splitState;
        const dim = DIMENSION_OF_AXIS[axis];
        const size = piece[dim];
        const { at } = this.splitState;
        const inside = at > 0 && at < size;
        const options = axes.map((a) => [a, `${capitalize(DIMENSION_OF_AXIS[a])} (${formatLength(piece[DIMENSION_OF_AXIS[a]], unit)})`]);
        if (this.splitAxis.dataset.options !== JSON.stringify(options)) {
            this.splitAxis.dataset.options = JSON.stringify(options);
            this.splitAxis.replaceChildren(...options.map(([value, text]) => el('option', { value, textContent: text })));
        }
        this.splitAxis.value = axis;
        this.splitAt.setLabel(`First piece ${dim}, from the ${LOW_EDGE[axis]}`);
        this.splitAt.set(at);
        // Keep what was typed even if it is past the end; Split explains.
        this.splitRest.textContent = inside
            ? `Second piece ${dim}: ${formatLength(size - at, unit)}`
            : `The piece is only ${formatLength(size, unit)} ${dim === 'height' ? 'tall' : dim === 'depth' ? 'deep' : 'wide'}`;
        this.scene.setSplitPreview(this.splitDetails.open && inside ? { pieceId: piece.id, axis, at } : null);
    }

    // A titled row of fields that can move between the panel and the
    // floating inspector. The title shows in the inspector, the hint in the panel.
    _block(title, hint, fields) {
        return el('div', { className: 'transform-block' }, [
            el('span', { className: 'block-title', textContent: title }),
            ...(hint ? [el('p', { className: 'hint', textContent: hint })] : []),
            el('div', { className: 'row' }, fields),
        ]);
    }

    // Step size plus -/+ buttons per axis, for touch screens without arrow keys.
    _buildMoveControls() {
        this.stepSelect = el('select');
        this.stepSelect.addEventListener('change', () => {
            this.step = Number(this.stepSelect.value);
        });
        this._syncSteps();

        const button = (axis, direction) => {
            const node = el('button', {
                type: 'button',
                className: 'secondary',
                textContent: direction < 0 ? '-' : '+',
                title: `Move ${direction < 0 ? '-' : '+'}${axis.toUpperCase()}`,
            });
            node.addEventListener('click', () => this.project.moveSelection({ [axis]: direction * this.step }));
            return node;
        };
        const axisNames = { x: 'X (left/right)', y: 'Y (down/up)', z: 'Z (back/front)' };
        return el('div', { className: 'move' }, [
            el('label', { className: 'field' }, [el('span', { textContent: 'Move step' }), this.stepSelect]),
            ...AXES.map((axis) => el('div', { className: 'move-row' }, [
                el('span', { textContent: axisNames[axis] }),
                button(axis, -1),
                button(axis, 1),
            ])),
            el('p', {
                className: 'hint',
                textContent: 'Keys: Left/Right moves X, Up/Down moves Z, Shift+Up/Down moves Y.',
            }),
        ]);
    }

    // Step options follow the unit system; keep the step if it is still offered.
    _syncSteps() {
        const steps = moveSteps(this.project.unit);
        if (this.stepSelect.dataset.system !== String(steps === MOVE_STEPS.imperial)) {
            this.stepSelect.dataset.system = String(steps === MOVE_STEPS.imperial);
            this.stepSelect.replaceChildren(...steps.map((s) => el('option', { value: String(s.mm), textContent: s.label })));
            if (!steps.some((s) => s.mm === this.step)) {
                this.step = steps.find((s) => s.default).mm;
            }
            this.stepSelect.value = String(this.step);
        }
    }

    _buildActions() {
        this.groupButton = el('button', { type: 'button', textContent: 'Group', title: 'Ctrl+G' });
        this.groupButton.addEventListener('click', () => this.project.group());
        this.ungroupButton = el('button', { type: 'button', className: 'secondary', textContent: 'Ungroup', title: 'Ctrl+Shift+G' });
        this.ungroupButton.addEventListener('click', () => this.project.ungroup());
        const duplicate = el('button', { type: 'button', className: 'secondary', textContent: 'Duplicate', title: 'Ctrl+D' });
        duplicate.addEventListener('click', () => this.project.duplicate());
        const remove = el('button', { type: 'button', className: 'danger', textContent: 'Delete' });
        remove.addEventListener('click', () => this.project.remove());
        return el('div', { className: 'actions' }, [this.groupButton, this.ungroupButton, duplicate, remove]);
    }

    _buildEstimate() {
        this.estimateBody = el('div');
        return el('section', {}, [el('h2', { textContent: 'Sheets to buy' }), this.estimateBody]);
    }

    _sheetName() {
        const { sheet, unit } = this.project;
        const preset = SHEET_PRESETS.find((p) => Math.abs(p.length - sheet.length) < 0.01 && Math.abs(p.width - sheet.width) < 0.01);
        return preset ? preset.label.replace(/ \(.*\)$/, '') : sizeText(sheet.width, sheet.length, unit);
    }

    _renderSheetSettings() {
        const { sheet } = this.project;
        const preset = SHEET_PRESETS.findIndex((p) => Math.abs(p.length - sheet.length) < 0.01 && Math.abs(p.width - sheet.width) < 0.01);
        const custom = this.customSheetChosen || preset < 0;
        this.sheetPreset.value = custom ? 'custom' : String(preset);
        this.customSheet.hidden = !custom;
        this.sheetLength.set(sheet.length);
        this.sheetWidth.set(sheet.width);
        this.kerfField.set(sheet.kerf);
        this.rotateCheck.checked = sheet.allowRotate;
    }

    _renderEstimate() {
        const { pieces, sheet, unit } = this.project;
        const groups = estimateSheets(pieces, sheet);
        const name = this._sheetName();
        if (!groups.length) {
            this.estimateBody.replaceChildren(el('p', { className: 'hint', textContent: 'Add pieces to see how many sheets you need.' }));
            return;
        }
        const blocks = groups.map((group) => {
            const count = group.sheets.length;
            const summary = `${formatLength(group.thickness, unit)} plywood: ${count} sheet${count === 1 ? '' : 's'} of ${name}`
                + (count ? `, ${Math.round(group.used * 100)}% used` : '');
            const parts = [el('p', { className: 'estimate-line', textContent: summary })];
            if (group.oversized.length) {
                const list = group.oversized.map((p) => `${p.name} (${sizeText(p.length, p.width, unit)})`).join(', ');
                parts.push(el('p', { className: 'error', textContent: `Too big for a ${name} sheet: ${list}` }));
            }
            group.sheets.forEach((layout, index) => {
                parts.push(el('figure', { className: 'sheet' }, [
                    el('figcaption', { textContent: `Sheet ${index + 1} of ${count}` }),
                    // Expanded on a computer, diagrams are shown about twice as big.
                    sheetDiagram(layout, sheet, unit, { textScale: this.expanded && this._wide() ? 0.55 : 1 }),
                    el('ol', { className: 'sheet-legend' }, layout.placements.map((p) => el('li', {
                        textContent: `${p.name}: ${sizeText(p.w, p.h, unit)}${p.rotated ? ' (across the grain)' : ''}`,
                    }))),
                ]));
            });
            return el('div', { className: 'estimate-group' }, parts);
        });
        blocks.push(el('p', {
            className: 'hint',
            textContent: `Estimate using straight through-cuts with ${formatLength(sheet.kerf, unit)} left for the saw blade. `
                + 'The grain runs left to right on the diagrams. Change the sheet size and saw in Settings.',
        }));
        this.estimateBody.replaceChildren(...blocks);
    }

    _buildCutList() {
        this.cutBody = el('tbody');
        const head = el('tr', {}, ['Qty', 'Thick', 'Length', 'Width', 'Pieces'].map((text) => el('th', { textContent: text })));
        return el('section', {}, [
            el('h2', { textContent: 'Cut list' }),
            el('div', { className: 'table-wrap' }, [el('table', { className: 'cutlist' }, [el('thead', {}, [head]), this.cutBody])]),
        ]);
    }

    _size(pieces) {
        const box = bounds(pieces);
        const { unit } = this.project;
        return [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z]
            .map((mm) => formatLength(mm, unit))
            .join(' x ');
    }

    // One row per node; groups list their children underneath. `inSelection`
    // marks nodes whose group is selected, so they are highlighted too.
    _renderNode(key, inSelection) {
        const { kind, id } = parseKey(key);
        const node = this.project.getNode(key);
        const active = this.project.selection.includes(key);
        const pieces = this.project.piecesIn(key);
        const button = el('button', {
            type: 'button',
            className: `node ${kind}${active ? ' active' : inSelection ? ' within' : ''}`,
            textContent: kind === 'group'
                ? `${node.name} (${pieces.length} pieces)`
                : `${node.name}: ${DIMENSIONS.map((dim) => formatLength(node[dim], this.project.unit)).join(' x ')}`,
        });
        button.addEventListener('click', (ev) => {
            if (ev.shiftKey || this.multiSelect.checked) {
                this.project.toggle(key);
            } else {
                this.project.select([key]);
            }
        });
        const children = kind === 'group'
            ? [el('ul', {}, this.project.childrenOf(id).map((child) => this._renderNode(child, active || inSelection)))]
            : [];
        return el('li', {}, [button, ...children]);
    }

    render() {
        const { unit, pieces, selection } = this.project;
        const piece = this.project.selectedPiece;
        const group = this.project.selectedGroup;
        this.unitSelect.value = unit;
        this.title.textContent = this.project.name;
        this.undoButton.disabled = !this.project.canUndo;
        this.redoButton.disabled = !this.project.canRedo;
        if (document.activeElement !== this.nameField) {
            this.nameField.value = this.project.name;
        }
        this._syncSteps();
        for (const field of this.fields) {
            field.render();
        }

        this.tree.replaceChildren(...this.project.childrenOf(null).map((key) => this._renderNode(key, false)));

        this.editor.hidden = !selection.length;
        this.editorError.hidden = true;
        this.groupFields.hidden = !group;
        this.pieceFields.hidden = !piece;
        this._renderSplit();
        this.selectionFields.hidden = Boolean(piece) || !selection.length;
        // The blocks may be in the inspector, outside these containers.
        for (const block of [this.sizeBlock, this.posBlock, this.rotBlock]) {
            block.hidden = !piece;
        }
        this.selSizeBlock.hidden = this.selectionFields.hidden;
        this.selPosBlock.hidden = this.selectionFields.hidden;
        this.groupRotBlock.hidden = !group;
        if (this.inspector) {
            this.inspector.show(selection.length > 0);
        }
        this.groupButton.disabled = selection.length < 2;
        this.ungroupButton.disabled = !selection.some((key) => parseKey(key).kind === 'group');
        if (piece) {
            this.editorTitle.textContent = 'Selected piece';
            this.nameInput.value = piece.name;
            for (const dim of DIMENSIONS) {
                this.dimFields[dim].set(piece[dim]);
            }
            for (const axis of AXES) {
                this.posFields[axis].set(piece.position[axis]);
                this.rotFields[axis].set(piece.rotation[axis]);
            }
        } else if (selection.length) {
            const selected = this.project.selectedPieces;
            this.editorTitle.textContent = group ? 'Selected group' : `${selection.length} items selected`;
            this.overall.textContent = `${selected.length} pieces, overall ${this._size(selected)}`;
            const box = bounds(selected);
            for (const axis of AXES) {
                this.selPosFields[axis].set(box.min[axis]);
            }
            if (group) {
                this.groupNameInput.value = group.name;
                for (const axis of AXES) {
                    this.groupRotFields[axis].set(group.rotation[axis]);
                }
            }
        }

        this._renderSheetSettings();
        this._renderEstimate();

        const rows = buildCutList(pieces);
        this.cutBody.replaceChildren(...(rows.length ? rows.map((row) => el('tr', {}, [
            el('td', { textContent: String(row.quantity) }),
            el('td', { textContent: formatLength(row.thickness, unit) }),
            el('td', { textContent: formatLength(row.length, unit) }),
            el('td', { textContent: formatLength(row.width, unit) }),
            el('td', { textContent: row.names.join(', ') }),
        ])) : [el('tr', {}, [el('td', { colSpan: 5, className: 'hint', textContent: 'No pieces yet' })])]));
    }
}
