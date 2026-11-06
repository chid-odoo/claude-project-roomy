// Box template: outer dimensions plus sheet thickness -> butt-jointed panels.
// Front and back run the full width and height, the sides fit between them,
// and the bottom (and optional top) fit inside all four walls.

export function createBox({ width, height, depth, thickness, closed = false, origin = {} }) {
    const t = thickness;
    if (!(t > 0)) {
        throw new Error('Thickness must be a positive number');
    }
    if (!(width > 2 * t) || !(depth > 2 * t)) {
        throw new Error('Width and depth must be more than twice the thickness');
    }
    if (!(height > (closed ? 2 * t : t))) {
        throw new Error('Height is too small for the thickness');
    }

    const o = { x: 0, y: 0, z: 0, ...origin };
    const at = (x, y, z) => ({ x: o.x + x, y: o.y + y, z: o.z + z });
    const innerWidth = width - 2 * t;
    const innerDepth = depth - 2 * t;

    const pieces = [
        // +Z points at the default camera, so the front is the far-Z panel.
        { name: 'Front', width, height, depth: t, position: at(0, 0, depth - t) },
        { name: 'Back', width, height, depth: t, position: at(0, 0, 0) },
        { name: 'Left side', width: t, height, depth: innerDepth, position: at(0, 0, t) },
        { name: 'Right side', width: t, height, depth: innerDepth, position: at(width - t, 0, t) },
        { name: 'Bottom', width: innerWidth, height: t, depth: innerDepth, position: at(t, 0, t) },
    ];
    if (closed) {
        pieces.push({
            name: 'Top',
            width: innerWidth,
            height: t,
            depth: innerDepth,
            position: at(t, height - t, t),
        });
    }
    return pieces;
}
