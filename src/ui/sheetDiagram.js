// SVG cutting diagram for one stock sheet, drawn to scale in mm. Pieces are
// numbered; the number matches the legend under the diagram, and pieces
// with room for it also show their name and size.
import { formatLength } from '../model/units.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHAR_WIDTH = 0.6; // rough width of a character, as a fraction of font size

function svg(tag, attrs = {}, children = []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
        node.setAttribute(key, String(value));
    }
    node.append(...children);
    return node;
}

// Largest font size (up to `max`) at which `lines` fit in a w x h box.
function fitFont(lines, w, h, max) {
    const longest = Math.max(...lines.map((line) => line.length));
    return Math.min(max, (w * 0.9) / (longest * CHAR_WIDTH), (h * 0.8) / (lines.length * 1.2));
}

function label(lines, x, y, size) {
    const top = y - ((lines.length - 1) * size * 1.2) / 2;
    return svg('text', { x, y: top, 'font-size': size.toFixed(1), 'text-anchor': 'middle', 'dominant-baseline': 'central' },
        lines.map((line, i) => {
            const span = svg('tspan', { x, dy: i ? (size * 1.2).toFixed(1) : 0 });
            span.textContent = line;
            return span;
        }));
}

export function sizeText(w, h, unit) {
    return `${formatLength(w, unit)} x ${formatLength(h, unit)}`;
}

// `layout` is one sheet from estimateSheets(); `sheet` is the stock size.
// `textScale` shrinks the label size in sheet terms when the diagram is
// shown bigger (expanded panel), so more pieces get their name and size.
export function sheetDiagram(layout, sheet, unit, { textScale = 1 } = {}) {
    // Docked, diagrams are shown about 300 px wide for a 2440 mm sheet, so
    // text needs to be big in sheet terms to be readable at all.
    const base = Math.min(sheet.width, sheet.length) * 0.09 * textScale; // preferred font size in mm
    const min = base * 0.6;
    const pieces = layout.placements.map((p, index) => {
        const number = String(index + 1);
        const size = sizeText(p.w, p.h, unit);
        const cx = p.x + p.w / 2;
        const cy = p.y + p.h / 2;
        const title = svg('title');
        title.textContent = `${number}. ${p.name}: ${size}${p.rotated ? ' (turned across the grain)' : ''}`;
        // Name and size if they fit at a readable size, else the name, else
        // just the number as large as the piece allows.
        const options = [[`${number}. ${p.name}`, size], [`${number}. ${p.name}`]];
        const fits = options.find((lines) => fitFont(lines, p.w, p.h, base) >= min);
        const text = fits
            ? label(fits, cx, cy, fitFont(fits, p.w, p.h, base))
            : label([number], cx, cy, fitFont([number], p.w, p.h, base));
        return svg('g', { class: 'sheet-piece' }, [
            title,
            svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, 'vector-effect': 'non-scaling-stroke' }),
            text,
        ]);
    });
    const caption = `Sheet ${sizeText(sheet.width, sheet.length, unit)}, grain runs left to right`;
    const drawing = svg('svg', {
        viewBox: `0 0 ${sheet.length} ${sheet.width}`,
        class: 'sheet-diagram',
        role: 'img',
        'aria-label': caption,
    }, [
        svg('rect', { class: 'sheet-stock', x: 0, y: 0, width: sheet.length, height: sheet.width, 'vector-effect': 'non-scaling-stroke' }),
        ...pieces,
    ]);
    return drawing;
}
