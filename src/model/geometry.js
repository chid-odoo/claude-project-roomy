// Rotation helpers. A piece's rotation is in degrees, applied about its own
// centre in X, then Y, then Z order (Three.js's default 'XYZ' Euler order, so
// the scene can use the values as they are).
import { Euler, MathUtils, Quaternion, Vector3 } from 'three';

export const ZERO_ROTATION = Object.freeze({ x: 0, y: 0, z: 0 });

// Any angle -> the same angle in (-180, 180].
export function normalizeAngle(deg) {
    const angle = ((deg % 360) + 360) % 360;
    return angle > 180 ? angle - 360 : angle;
}

// Round away float noise so 89.99999999 shows as 90 and -0 as 0.
function clean(deg) {
    const value = Math.round(normalizeAngle(deg) * 1e6) / 1e6;
    return Object.is(value, -0) || value === -180 ? Math.abs(value) : value;
}

export function quaternionOf(rotation = ZERO_ROTATION) {
    const r = MathUtils.degToRad;
    return new Quaternion().setFromEuler(new Euler(r(rotation.x), r(rotation.y), r(rotation.z), 'XYZ'));
}

export function rotationOf(quaternion) {
    const euler = new Euler().setFromQuaternion(quaternion, 'XYZ');
    const d = MathUtils.radToDeg;
    return { x: clean(d(euler.x)), y: clean(d(euler.y)), z: clean(d(euler.z)) };
}

export function pieceCenter(piece) {
    return {
        x: piece.position.x + piece.width / 2,
        y: piece.position.y + piece.height / 2,
        z: piece.position.z + piece.depth / 2,
    };
}

// A point given relative to the piece's unrotated corner -> world position.
export function pieceToWorld(piece, local) {
    const c = pieceCenter(piece);
    const v = new Vector3(local.x - piece.width / 2, local.y - piece.height / 2, local.z - piece.depth / 2)
        .applyQuaternion(quaternionOf(piece.rotation))
        .add(new Vector3(c.x, c.y, c.z));
    return { x: v.x, y: v.y, z: v.z };
}

// A distance along one of the piece's own axes ('x', 'y' or 'z'), turned
// with the piece: the world offset, in mm.
export function alongPiece(piece, axis, distance) {
    const v = new Vector3(0, 0, 0);
    v[axis] = distance;
    v.applyQuaternion(quaternionOf(piece.rotation));
    return { x: v.x, y: v.y, z: v.z };
}

// The eight corners of a piece after rotation, in mm.
export function pieceCorners(piece) {
    const corners = [];
    for (const x of [0, piece.width]) {
        for (const y of [0, piece.height]) {
            for (const z of [0, piece.depth]) {
                corners.push(pieceToWorld(piece, { x, y, z }));
            }
        }
    }
    return corners;
}

// Rotate pieces together by `delta` (a Quaternion) about `pivot`: each
// piece's centre swings round the pivot and its own rotation turns with it.
export function rotatePiecesAbout(pieces, delta, pivot) {
    const p = new Vector3(pivot.x, pivot.y, pivot.z);
    for (const piece of pieces) {
        const c = pieceCenter(piece);
        const center = new Vector3(c.x, c.y, c.z).sub(p).applyQuaternion(delta).add(p);
        piece.position = {
            x: center.x - piece.width / 2,
            y: center.y - piece.height / 2,
            z: center.z - piece.depth / 2,
        };
        piece.rotation = rotationOf(delta.clone().multiply(quaternionOf(piece.rotation)));
    }
}

// Average of the piece centres. Unlike the bounding-box centre it does not
// move when the pieces rotate around it, so repeated rotations don't drift.
export function centroid(pieces) {
    const sum = { x: 0, y: 0, z: 0 };
    for (const piece of pieces) {
        const c = pieceCenter(piece);
        sum.x += c.x;
        sum.y += c.y;
        sum.z += c.z;
    }
    return { x: sum.x / pieces.length, y: sum.y / pieces.length, z: sum.z / pieces.length };
}

// Axis-aligned bounding box of all pieces (rotated corners included) in mm,
// or null when there are none.
export function bounds(pieces) {
    if (!pieces.length) {
        return null;
    }
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const piece of pieces) {
        for (const corner of pieceCorners(piece)) {
            for (const axis of ['x', 'y', 'z']) {
                min[axis] = Math.min(min[axis], corner[axis]);
                max[axis] = Math.max(max[axis], corner[axis]);
            }
        }
    }
    return { min, max };
}
