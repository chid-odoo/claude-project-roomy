// Sheet estimate: lay the pieces out on stock sheets (e.g. 4' x 8') to see
// how many sheets to buy and how to cut them.
//
// Layouts are guillotine cuts: every cut runs straight across the board it
// is cutting, as on a table saw or with a circular saw and a guide. Each
// thickness is packed onto its own sheets. Pieces are placed biggest first;
// each goes into the free space it fits most snugly (best short side fit),
// and the space left over is split along its shorter side. That is a
// heuristic, so the count is a good estimate rather than a proven minimum.
//
// Sheet coordinates: x runs along the sheet's length (its grain), y along
// its width, both from the top-left corner, in mm.

export const SHEET_PRESETS = [
    { label: '4\' x 8\'', length: 2438.4, width: 1219.2 },
    { label: '4\' x 4\'', length: 1219.2, width: 1219.2 },
    { label: '2\' x 4\'', length: 1219.2, width: 609.6 },
    { label: '5\' x 5\' (Baltic birch)', length: 1524, width: 1524 },
    { label: '1220 x 2440 mm', length: 2440, width: 1220 },
];

export const DEFAULT_SHEET = Object.freeze({
    length: 2438.4,
    width: 1219.2,
    kerf: 3.175, // 1/8"
    allowRotate: true,
});

const EPS = 1e-6;
const THICKNESS_TOLERANCE = 0.01; // mm, as in the cut list

export function validateSheet(sheet) {
    for (const key of ['length', 'width']) {
        if (!(Number.isFinite(sheet[key]) && sheet[key] > 0)) {
            throw new Error(`Sheet ${key} must be a positive number`);
        }
    }
    if (!(Number.isFinite(sheet.kerf) && sheet.kerf >= 0)) {
        throw new Error('Saw kerf must be zero or more');
    }
    if (typeof sheet.allowRotate !== 'boolean') {
        throw new Error('Allow rotating pieces must be true or false');
    }
}

// A piece as cut from a sheet: thinnest dimension is the thickness, the
// longest is its length (laid along the grain unless rotated).
function stockPiece(piece) {
    const [thickness, width, length] = [piece.width, piece.height, piece.depth].sort((a, b) => a - b);
    return { id: piece.id, name: piece.name, thickness, length, width };
}

// Place one piece into a free rectangle and return the leftover space,
// split along the shorter leftover side.
function split(free, w, h, kerf) {
    const right = free.w - w - kerf;
    const below = free.h - h - kerf;
    const rects = (free.w - w) <= (free.h - h)
        ? [
            { x: free.x + w + kerf, y: free.y, w: right, h }, // beside, as tall as the piece
            { x: free.x, y: free.y + h + kerf, w: free.w, h: below }, // full-width strip below
        ]
        : [
            { x: free.x + w + kerf, y: free.y, w: right, h: free.h }, // full-height strip beside
            { x: free.x, y: free.y + h + kerf, w, h: below }, // below, as wide as the piece
        ];
    return rects.filter((rect) => rect.w > EPS && rect.h > EPS);
}

function packThickness(pieces, sheet) {
    const orientations = (piece) => {
        const along = { w: piece.length, h: piece.width, rotated: false };
        const across = { w: piece.width, h: piece.length, rotated: true };
        return sheet.allowRotate && piece.length !== piece.width ? [along, across] : [along];
    };
    const fitsSheet = (piece) => orientations(piece).some((o) => o.w <= sheet.length + EPS && o.h <= sheet.width + EPS);

    const sheets = [];
    const oversized = [];
    const order = [...pieces].sort((a, b) => b.length * b.width - a.length * a.width || b.length - a.length);
    for (const piece of order) {
        if (!fitsSheet(piece)) {
            oversized.push(piece);
            continue;
        }
        let best = null;
        const consider = (target, freeIndex, free) => {
            for (const o of orientations(piece)) {
                if (o.w > free.w + EPS || o.h > free.h + EPS) {
                    continue;
                }
                const shortSide = Math.min(free.w - o.w, free.h - o.h);
                const longSide = Math.max(free.w - o.w, free.h - o.h);
                if (!best || shortSide < best.shortSide - EPS
                    || (Math.abs(shortSide - best.shortSide) <= EPS && longSide < best.longSide - EPS)) {
                    best = { target, freeIndex, free, o, shortSide, longSide };
                }
            }
        };
        sheets.forEach((target) => target.free.forEach((free, index) => consider(target, index, free)));
        if (!best) {
            const target = { placements: [], free: [{ x: 0, y: 0, w: sheet.length, h: sheet.width }] };
            sheets.push(target);
            consider(target, 0, target.free[0]);
        }
        const { target, freeIndex, free, o } = best;
        target.placements.push({
            id: piece.id, name: piece.name, x: free.x, y: free.y, w: o.w, h: o.h, rotated: o.rotated,
        });
        target.free.splice(freeIndex, 1, ...split(free, o.w, o.h, sheet.kerf));
    }

    const sheetArea = sheet.length * sheet.width;
    const used = (placements) => placements.reduce((sum, p) => sum + p.w * p.h, 0);
    const out = sheets.map(({ placements }) => ({ placements, used: used(placements) / sheetArea }));
    const total = out.reduce((sum, s) => sum + s.used, 0);
    return { sheets: out, oversized, used: out.length ? total / out.length : 0 };
}

// Returns one entry per thickness, thinnest first:
//   { thickness, sheets: [{ placements, used }], oversized: [piece], used }
// where `used` is the fraction of sheet area covered by pieces.
export function estimateSheets(pieces, sheet = DEFAULT_SHEET) {
    validateSheet(sheet);
    const groups = [];
    for (const piece of pieces.map(stockPiece)) {
        let group = groups.find((g) => Math.abs(g.thickness - piece.thickness) < THICKNESS_TOLERANCE);
        if (!group) {
            group = { thickness: piece.thickness, pieces: [] };
            groups.push(group);
        }
        group.pieces.push(piece);
    }
    return groups
        .sort((a, b) => a.thickness - b.thickness)
        .map(({ thickness, pieces: group }) => ({ thickness, ...packThickness(group, sheet) }));
}
