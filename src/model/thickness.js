// Changing board thickness. A board's thickness is its smallest dimension,
// whichever of width, height or depth that is (as in the cut list).
//
// A board in a group (a box) keeps its outer face, the one farther from the
// group's centre, and grows or shrinks inward. A board on its own keeps the
// face nearest the origin, so the position shown for it doesn't change.
// Any board whose end butts against a face that moves is trimmed or
// lengthened to meet it again, so butt joints stay closed; a board lying flat
// against a moving face is moved with it instead. Only boards touching a
// moved face directly are adjusted.
//
// Everything is worked out in world space, so rotated boxes work too.
import { Vector3 } from 'three';
import { pieceCenter, quaternionOf } from './geometry.js';

const DIMS = ['width', 'height', 'depth'];
const CONTACT_TOLERANCE = 0.05; // mm; faces closer than this touch

// Index (0 = width, 1 = height, 2 = depth) of the piece's thickness.
function thinIndex(piece) {
    return DIMS.reduce((best, dim, i) => (piece[dim] < piece[DIMS[best]] ? i : best), 0);
}

export function thicknessOf(piece) {
    return piece[DIMS[thinIndex(piece)]];
}

// Centre, world directions of the piece's own x/y/z, and half sizes.
function frameOf(piece) {
    const q = quaternionOf(piece.rotation);
    const c = pieceCenter(piece);
    return {
        center: new Vector3(c.x, c.y, c.z),
        axes: [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((v) => v.applyQuaternion(q)),
        half: DIMS.map((dim) => piece[dim] / 2),
    };
}

// One face of a piece: `side` is +1 for the face on the +axis side.
function faceOf(frame, index, side) {
    const normal = frame.axes[index].clone().multiplyScalar(side);
    const others = [0, 1, 2].filter((i) => i !== index);
    return {
        normal,
        point: frame.center.clone().addScaledVector(normal, frame.half[index]),
        spans: others.map((i) => ({ dir: frame.axes[i], half: frame.half[i] })),
    };
}

function corners(face) {
    const [a, b] = face.spans;
    return [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([i, j]) => face.point.clone()
        .addScaledVector(a.dir, i * a.half)
        .addScaledVector(b.dir, j * b.half));
}

// Two faces touch when they point at each other, lie in the same plane and
// overlap by more than the tolerance.
function touches(face, other) {
    if (face.normal.dot(other.normal) > -1 + 1e-6) {
        return false;
    }
    if (Math.abs(other.point.clone().sub(face.point).dot(face.normal)) > CONTACT_TOLERANCE) {
        return false;
    }
    const points = corners(other);
    return face.spans.every(({ dir, half }) => {
        const along = points.map((p) => p.clone().sub(face.point).dot(dir));
        return Math.min(half, Math.max(...along)) - Math.max(-half, Math.min(...along)) > CONTACT_TOLERANCE;
    });
}

// The side (+1 / -1) of a piece's thickness whose face is nearest the origin.
function lowSide(axis) {
    const parts = [axis.x, axis.y, axis.z];
    const main = parts.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);
    return main > 0 ? -1 : 1;
}

// New size and position of every piece that changes when `targets` are made
// `thickness` thick. `pieces` is every piece in the project (any of them may
// butt against a target); `centres` maps a target's id to the centre of its
// group, if it is in one. Returns a Map of id -> { width, height, depth, position }.
export function thicknessChanges(pieces, targets, thickness, centres = new Map()) {
    const frames = new Map(pieces.map((piece) => [piece.id, frameOf(piece)]));
    // Per piece and own axis: how far its low and high faces move along that axis.
    const moves = new Map();
    const moveOf = (id) => {
        if (!moves.has(id)) {
            moves.set(id, [[0, 0], [0, 0], [0, 0]]);
        }
        return moves.get(id);
    };

    const moving = [];
    for (const piece of targets) {
        const index = thinIndex(piece);
        const delta = thickness - piece[DIMS[index]];
        if (Math.abs(delta) < 1e-9) {
            continue;
        }
        const frame = frames.get(piece.id);
        const axis = frame.axes[index];
        let kept = lowSide(axis);
        const centre = centres.get(piece.id);
        if (centre) {
            const offset = new Vector3(centre.x, centre.y, centre.z).sub(frame.center).dot(axis);
            if (Math.abs(offset) > CONTACT_TOLERANCE) {
                kept = offset > 0 ? -1 : 1;
            }
        }
        const side = -kept;
        moveOf(piece.id)[index][side > 0 ? 1 : 0] += side * delta;
        moving.push({ id: piece.id, face: faceOf(frame, index, side), delta });
    }

    const adjusted = new Set();
    for (const { id, face, delta } of moving) {
        for (const other of pieces) {
            if (other.id === id) {
                continue;
            }
            const frame = frames.get(other.id);
            const thin = thinIndex(other);
            for (const index of [0, 1, 2]) {
                for (const side of [-1, 1]) {
                    const key = `${other.id}:${index}:${side}`;
                    if (adjusted.has(key) || !touches(face, faceOf(frame, index, side))) {
                        continue;
                    }
                    adjusted.add(key);
                    const shift = delta * face.normal.dot(frame.axes[index]);
                    const move = moveOf(other.id)[index];
                    if (index === thin) {
                        move[0] += shift;
                        move[1] += shift;
                    } else {
                        move[side > 0 ? 1 : 0] += shift;
                    }
                }
            }
        }
    }

    const byId = new Map(pieces.map((piece) => [piece.id, piece]));
    const changes = new Map();
    for (const [id, move] of moves) {
        const piece = byId.get(id);
        const frame = frames.get(id);
        const size = DIMS.map((dim, i) => piece[dim] + move[i][1] - move[i][0]);
        if (size.some((v) => !(v > 1e-6))) {
            throw new Error(`${piece.name} would be too small for that thickness`);
        }
        const center = frame.center.clone();
        move.forEach(([low, high], i) => center.addScaledVector(frame.axes[i], (low + high) / 2));
        changes.set(id, {
            width: size[0],
            height: size[1],
            depth: size[2],
            position: { x: center.x - size[0] / 2, y: center.y - size[1] / 2, z: center.z - size[2] / 2 },
        });
    }
    return changes;
}
