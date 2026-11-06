// The model works in millimetres from a corner; the scene works in metres
// from the centre of each box. Keeping the scene in metres keeps the camera
// near/far range sane for anything from a drawer to a shed.
import { bounds, pieceCenter, pieceToWorld, ZERO_ROTATION } from '../model/geometry.js';

export const MM_PER_SCENE_UNIT = 1000;

const toScene = (point) => [point.x, point.y, point.z].map((v) => v / MM_PER_SCENE_UNIT);

export function pieceTransform(piece) {
    const s = MM_PER_SCENE_UNIT;
    const rotation = piece.rotation || ZERO_ROTATION;
    return {
        scale: [piece.width / s, piece.height / s, piece.depth / s],
        center: toScene(pieceCenter(piece)),
        rotation: [rotation.x, rotation.y, rotation.z].map((deg) => (deg * Math.PI) / 180),
    };
}

// Where to put the width/height/depth labels of a piece, in scene units:
// the middle of its front-bottom, front-left and left-bottom edges, turned
// with the piece. Works for unrotated extents too (no `rotation`).
export function labelAnchors(piece) {
    const { width: w, height: h, depth: d } = piece;
    const at = (x, y, z) => toScene(pieceToWorld(piece, { x, y, z }));
    return {
        width: at(w / 2, 0, d),
        height: at(0, h / 2, d),
        depth: at(0, 0, d / 2),
    };
}

export { bounds };
