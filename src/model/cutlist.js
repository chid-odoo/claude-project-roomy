// Cut list: what to cut from sheet stock. The smallest dimension of a piece is
// its thickness, the other two are length (longest) and width.

const TOLERANCE = 0.01; // mm; pieces closer than this count as identical

function sameSize(a, b) {
    return ['thickness', 'length', 'width'].every((key) => Math.abs(a[key] - b[key]) < TOLERANCE);
}

export function buildCutList(pieces) {
    const rows = [];
    for (const piece of pieces) {
        const [thickness, width, length] = [piece.width, piece.height, piece.depth].sort((a, b) => a - b);
        const size = { thickness, length, width };
        const row = rows.find((existing) => sameSize(existing, size));
        if (row) {
            row.quantity += 1;
            row.names.push(piece.name);
        } else {
            rows.push({ ...size, quantity: 1, names: [piece.name] });
        }
    }
    return rows.sort((a, b) => a.thickness - b.thickness || b.length - a.length || b.width - a.width);
}
