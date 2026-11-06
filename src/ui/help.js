// Content of the Help view: how to use the app, its shortcuts and settings.

const SHORTCUTS = [
    ['Click a piece', 'Select it, or its whole group'],
    ['Double-click a piece', 'Select just that piece inside a group'],
    ['Shift + click', 'Add to or remove from the selection'],
    ['Click empty space', 'Clear the selection'],
    ['Left / Right', 'Move the selection along X'],
    ['Up / Down', 'Move the selection along Z (away / toward you)'],
    ['Shift + Up / Down', 'Move the selection along Y (up / down)'],
    ['Ctrl + G', 'Group the selection'],
    ['Ctrl + Shift + G', 'Ungroup'],
    ['Ctrl + D', 'Duplicate the selection'],
    ['Ctrl + Z', 'Undo'],
    ['Ctrl + Shift + Z or Ctrl + Y', 'Redo'],
    ['Drag in the 3D view', 'Orbit the camera'],
    ['Right-drag or two fingers', 'Pan the camera'],
    ['Scroll or pinch', 'Zoom'],
];

// [heading, paragraphs or lists]; a nested array is a bulleted list.
const SECTIONS = [
    ['Getting started', [
        'Roomy helps you design things to build from plywood and other sheet stock. Everything you add is a '
            + 'board with a width, height and depth, and the cut list at the bottom of the panel tells you what to cut.',
        [
            'New box: enter the outside width, height and depth, pick the plywood thickness and click Add box. '
                + 'The panels are sized to fit together with butt joints and are grouped as "Box 1", "Box 2"...',
            'Tick Closed top to add a lid panel.',
            'Add panel adds a single 24" x 24" board you can resize.',
        ],
    ]],
    ['Selecting', [
        [
            'Click a piece in the 3D view to select it. Pieces in a group select the whole group; double-click '
                + 'to pick one piece inside it.',
            'Click names in the Pieces list to select exactly that piece or group.',
            'Hold Shift, or tick Select multiple (handy on a phone), to select several things.',
            'The labels in the 3D view show the size of what is selected.',
        ],
    ]],
    ['Editing sizes, positions and rotation', [
        [
            'Select one piece to edit its name, width, height, depth, position and rotation.',
            'Type lengths in any unit: 30, 1 1/2, 3/4, 1\' 6", 45 cm or 450 mm all work.',
            'Drag a field up or down to change it; hold Shift for big steps or Alt for fine ones. On a phone, '
                + 'drag the small label above the field instead.',
            'Position is the corner nearest the origin before rotation. Rotation is in degrees, about the '
                + 'centre of the piece.',
            'With a group or several items selected, the X / Y / Z fields move everything together and '
                + 'Rotate X / Y / Z turns a group about its centre.',
            'Move step sets how far the arrow keys and the - / + buttons move things.',
        ],
    ]],
    ['Groups and copies', [
        [
            'Select two or more items and press Group (Ctrl + G). Groups can contain groups.',
            'Ungroup (Ctrl + Shift + G) takes a group apart one level.',
            'Duplicate (Ctrl + D) copies the selection, groups and all, and places the copy to the right. '
                + 'The copy is named like the original with " (copy)" added.',
            'Rename a group with the Group name field; rename a piece with its Name field.',
        ],
    ]],
    ['Cut list and sheets to buy', [
        [
            'The cut list groups identical pieces and gives each one\'s thickness, length and width.',
            'Sheets to buy packs the pieces onto stock sheets (4\' x 8\' unless you change it) and shows how many '
                + 'sheets each thickness needs and how much of them is used.',
            'Each sheet has a cutting diagram drawn to scale. Pieces are numbered to match the list under it; '
                + 'the grain runs left to right, and "across the grain" marks pieces turned to fit.',
            'Layouts use straight cuts that run all the way across, as on a table saw or with a circular saw '
                + 'and a guide, and leave room for the saw blade between pieces.',
            'It is a good estimate, not a guaranteed minimum; buy a spare sheet for mistakes.',
        ],
    ]],
    ['Undo, saving and sharing', [
        [
            'Undo and Redo are at the top of the panel (Ctrl + Z / Ctrl + Shift + Z). A whole drag or a held '
                + 'arrow key is one step.',
            'Your design is kept in this browser automatically and comes back when you reload.',
            'Save downloads a .json file named after the design. Send it to someone and they can Open it.',
            'Open replaces the current design (you can undo that). New starts an empty design.',
        ],
    ]],
    ['Settings', [
        'Open Settings with the gear icon at the top of the panel.',
        [
            'Units: how lengths are shown and how plain numbers you type are read. Millimetres, centimetres, '
                + 'metres, inches, or feet and inches. Imperial sizes are rounded to the nearest 1/16". '
                + 'Changing units never changes your design, only how it is shown, and it is saved with the file.',
            'Sheet size: the plywood sheets you buy, for the sheets estimate. Pick a common size or enter your own.',
            'Saw kerf: how much the saw blade removes, left as a gap between pieces. 1/8" suits most blades.',
            'Allow rotating pieces: lets the layout turn pieces across the grain to use fewer sheets. Turn it off '
                + 'when the grain must run the same way on every piece.',
            'Sheet settings are saved with the design but are not undo steps.',
        ],
    ]],
];

function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

export function buildHelp() {
    const sections = SECTIONS.map(([heading, blocks]) => el('section', {}, [
        el('h2', { textContent: heading }),
        ...blocks.map((block) => (Array.isArray(block)
            ? el('ul', {}, block.map((item) => el('li', { textContent: item })))
            : el('p', { textContent: block }))),
    ]));
    const shortcuts = el('section', {}, [
        el('h2', { textContent: 'Shortcuts' }),
        el('p', { className: 'hint', textContent: 'On a Mac, use Cmd instead of Ctrl.' }),
        el('table', { className: 'shortcuts' }, [el('tbody', {}, SHORTCUTS.map(([keys, action]) => el('tr', {}, [
            el('th', { textContent: keys }),
            el('td', { textContent: action }),
        ])))]),
    ]);
    return el('div', { className: 'help' }, [...sections, shortcuts]);
}
