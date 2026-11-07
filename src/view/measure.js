// Measuring tool logic: what a click snaps to and the measured distance.
// Kept free of the DOM so it can be tested; the scene supplies a function
// that projects a 3D point (mm) to screen pixels.
import { pieceCorners } from '../model/geometry.js';

export const SNAP_RADIUS = 12; // px

// Snap targets in world mm: corners as points, the 12 box edges of each
// piece as segments.
export function snapTargets(pieces) {
    const points = [];
    const edges = [];
    for (const piece of pieces) {
        // pieceCorners() varies z fastest, then y, then x: corners whose
        // indices differ in exactly one bit share an edge.
        const corners = pieceCorners(piece);
        corners.forEach((corner) => points.push({ point: corner, kind: 'corner' }));
        for (let i = 0; i < 8; i++) {
            for (const bit of [1, 2, 4]) {
                if (!(i & bit)) {
                    edges.push([corners[i], corners[i | bit]]);
                }
            }
        }
    }
    return { points, edges };
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

// Pick what a click at `pointer` (px) snaps to. `project(point)` returns
// { x, y, visible } in px. Corners win over edges; the nearest within
// `radius` wins. Returns { point, kind } or null.
export function snap(pointer, targets, project, radius = SNAP_RADIUS) {
    let best = null;
    const consider = (point, kind, distance) => {
        if (distance <= radius && (!best || distance < best.distance)) {
            best = { point, kind, distance };
        }
    };
    for (const { point, kind } of targets.points) {
        const p = project(point);
        if (p.visible) {
            consider(point, kind, Math.hypot(p.x - pointer.x, p.y - pointer.y));
        }
    }
    if (best) {
        return { point: best.point, kind: best.kind };
    }
    for (const [a, b] of targets.edges) {
        const pa = project(a);
        const pb = project(b);
        if (!pa.visible || !pb.visible) {
            continue;
        }
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const length2 = dx * dx + dy * dy;
        const t = length2 ? Math.min(1, Math.max(0, ((pointer.x - pa.x) * dx + (pointer.y - pa.y) * dy) / length2)) : 0;
        // Interpolating in 3D by the on-screen fraction is close enough
        // along a single board edge.
        consider(lerp(a, b, t), 'edge', Math.hypot(pa.x + dx * t - pointer.x, pa.y + dy * t - pointer.y));
    }
    return best && { point: best.point, kind: best.kind };
}

// Straight-line distance and its X / Y / Z parts (all positive), in mm.
export function measure(a, b) {
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const dz = Math.abs(b.z - a.z);
    return { distance: Math.hypot(dx, dy, dz), dx, dy, dz };
}
