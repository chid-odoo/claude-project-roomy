import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { formatLength, UNITS } from '../model/units.js';
import { pickPiece } from '../ui/input.js';
import { measure, snap, snapTargets } from './measure.js';
import { bounds, labelAnchors, MM_PER_SCENE_UNIT, pieceTransform } from './transform.js';

const WOOD = 0xd8b88a;
// Per-theme look of the 3D view. Dark is an evening room: dark walls fading
// to a slightly lighter floor, a dim warm fill and one warm lamp to the side.
const LOOKS = {
    light: {
        top: 0xf2f0eb, bottom: 0xf2f0eb, grid: [0xb5ada0, 0xd6d0c4], selected: 0x8fbfe8,
        fill: [0xffffff, 0x8a8070, 2], lamp: [0xffffff, 1.5], lampFrom: [2, 4, 3], shadow: 0.18,
    },
    dark: {
        top: 0x14110e, bottom: 0x2b251f, grid: [0x564b40, 0x362f28], selected: 0x7fb0dd,
        fill: [0xffe8d0, 0x14110e, 0.6], lamp: [0xffe2c4, 2.1], lampFrom: [-2, 3, 1.5], shadow: 0.5,
    },
};
const EDGE = 0x5a4630;
const MEASURE_LINE = 0xc0392b;
const SPLIT_LINE = 0xc0392b;
const CLICK_SLOP = 6; // px a pointer may move and still count as a tap
const DOUBLE_TAP_MS = 400;

const BOX = new THREE.BoxGeometry(1, 1, 1);
const BOX_EDGES = new THREE.EdgesGeometry(BOX);

export class DesignScene {
    constructor(container, project) {
        this.container = container;
        this.project = project;
        this.meshes = new Map();
        // Touch screens have no Shift key; the panel's "select multiple" toggle sets this.
        this.multiSelect = false;
        // Measure mode: clicks place points instead of selecting. Each
        // measurement is { a, b } in mm plus the objects drawing it.
        this.measuring = false;
        this.measurements = [];
        this.pendingPoint = null;
        this.onMeasuringChange = null;
        // Where the panel's "Split into two" would cut: { pieceId, axis, at }.
        this.splitPreview = null;

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.domElement.className = 'label-layer';
        container.appendChild(this.labelRenderer.domElement);

        this.scene = new THREE.Scene();
        this.fill = new THREE.HemisphereLight();
        // The lamp is the one light that casts shadows; sync() aims it and
        // fits its shadow camera around the pieces.
        this.lamp = new THREE.DirectionalLight();
        this.lamp.castShadow = true;
        this.lamp.shadow.mapSize.set(2048, 2048);
        this.lamp.shadow.bias = -0.0004;
        this.lamp.shadow.normalBias = 0.003;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // An invisible floor that only shows the shadows falling on it.
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial());
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.y = -0.0002;
        this.floor.receiveShadow = true;
        this.scene.add(this.fill, this.lamp, this.lamp.target, this.floor);

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
        this.camera.position.set(1.2, 1, 1.6);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.target.set(0.3, 0.15, 0.2);

        this.labels = ['width', 'height', 'depth'].map((dim) => {
            const el = document.createElement('div');
            el.className = `dim-label dim-${dim}`;
            const label = new CSS2DObject(el);
            label.userData.dim = dim;
            label.visible = false;
            this.scene.add(label);
            return label;
        });

        this.measureGroup = new THREE.Group();
        this.scene.add(this.measureGroup);
        this.splitMarker = this._buildSplitMarker();
        this.snapMarker = this._label('measure-snap');
        this.snapMarker.visible = false;
        this.scene.add(this.snapMarker);

        this._listenForTaps();
        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(container);
        this._resize();

        this.theme = null;
        this.setTheme('light');
        this.setShadows(true);
        this.project.onChange(() => this.sync());
        this.sync();
        this.renderer.setAnimationLoop(() => {
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
            this.labelRenderer.render(this.scene, this.camera);
        });
    }

    sync() {
        const { pieces, unit } = this.project;
        const selected = this.project.selectedPieces;
        const selectedIds = new Set(selected.map((piece) => piece.id));
        const ids = new Set(pieces.map((piece) => piece.id));
        for (const [id, mesh] of this.meshes) {
            if (!ids.has(id)) {
                this.scene.remove(mesh);
                mesh.material.dispose();
                this.meshes.delete(id);
            }
        }
        for (const piece of pieces) {
            let mesh = this.meshes.get(piece.id);
            if (!mesh) {
                mesh = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.85 }));
                mesh.add(new THREE.LineSegments(BOX_EDGES, new THREE.LineBasicMaterial({ color: EDGE })));
                mesh.userData.pieceId = piece.id;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                this.scene.add(mesh);
                this.meshes.set(piece.id, mesh);
            }
            const { scale, center, rotation } = pieceTransform(piece);
            mesh.scale.set(...scale);
            mesh.position.set(...center);
            mesh.rotation.set(...rotation);
            mesh.material.color.setHex(selectedIds.has(piece.id) ? LOOKS[this.theme].selected : WOOD);
        }
        this._aimLamp();
        this._syncLabels(selected, unit);
        this._syncGrid(unit);
        this._syncMeasureLabels(unit);
        this._syncSplitMarker();
    }

    // ---- split preview ------------------------------------------------------

    setSplitPreview(preview) {
        this.splitPreview = preview;
        this._syncSplitMarker();
    }

    _buildSplitMarker() {
        const outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: SPLIT_LINE, depthTest: false }));
        const fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
            color: SPLIT_LINE, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthTest: false,
        }));
        outline.renderOrder = 3;
        fill.renderOrder = 3;
        const group = new THREE.Group();
        group.add(fill, outline);
        group.visible = false;
        return { group, outline, fill };
    }

    // The cut plane, drawn inside the piece's mesh. The mesh is a unit cube
    // scaled to the piece, so the plane sits at at/size - 1/2 along the axis.
    _syncSplitMarker() {
        const { group, outline, fill } = this.splitMarker;
        const preview = this.splitPreview;
        const piece = preview && this.project.getPiece(preview.pieceId);
        const mesh = piece && this.meshes.get(piece.id);
        group.visible = Boolean(mesh);
        if (!mesh) {
            return;
        }
        const along = preview.at / piece[{ x: 'width', y: 'height', z: 'depth' }[preview.axis]] - 0.5;
        const [u, v] = ['x', 'y', 'z'].filter((a) => a !== preview.axis);
        const corner = (s, t) => {
            const point = new THREE.Vector3();
            point[preview.axis] = along;
            point[u] = s;
            point[v] = t;
            return point;
        };
        const quad = [corner(-0.5, -0.5), corner(0.5, -0.5), corner(0.5, 0.5), corner(-0.5, 0.5)];
        outline.geometry.setFromPoints(quad);
        fill.geometry.setFromPoints([quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]]);
        if (group.parent !== mesh) {
            mesh.add(group);
        }
    }

    // ---- measuring ---------------------------------------------------------

    setMeasuring(on) {
        if (this.measuring === on) {
            return;
        }
        this.measuring = on;
        if (!on) {
            this.clearMeasurements();
            this.snapMarker.visible = false;
        }
        this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
        if (this.onMeasuringChange) {
            this.onMeasuringChange(on);
        }
    }

    clearMeasurements() {
        for (const object of [...this.measureGroup.children]) {
            this.measureGroup.remove(object);
            if (object.geometry) {
                object.geometry.dispose();
            }
        }
        this.measurements = [];
        this.pendingPoint = null;
    }

    _label(className) {
        const el = document.createElement('div');
        el.className = className;
        return new CSS2DObject(el);
    }

    _toScene(point) {
        return new THREE.Vector3(point.x, point.y, point.z).divideScalar(MM_PER_SCENE_UNIT);
    }

    // The point a click at (clientX, clientY) measures to: a snapped corner
    // or edge, else wherever it hits a piece, else nothing.
    _measurePoint(clientX, clientY) {
        const canvas = this.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        const pointer = { x: clientX - rect.left, y: clientY - rect.top };
        const project = (point) => {
            const v = this._toScene(point).project(this.camera);
            return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height, visible: v.z < 1 };
        };
        const snapped = snap(pointer, snapTargets(this.project.pieces), project);
        if (snapped) {
            return snapped;
        }
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2((pointer.x / rect.width) * 2 - 1, -(pointer.y / rect.height) * 2 + 1), this.camera);
        const [hit] = raycaster.intersectObjects([...this.meshes.values()], false);
        if (!hit) {
            return null;
        }
        const mm = hit.point.clone().multiplyScalar(MM_PER_SCENE_UNIT);
        return { point: { x: mm.x, y: mm.y, z: mm.z }, kind: 'surface' };
    }

    _measureTap(clientX, clientY) {
        const hit = this._measurePoint(clientX, clientY);
        if (!hit) {
            return;
        }
        if (!this.pendingPoint) {
            const dot = this._label('measure-dot');
            dot.position.copy(this._toScene(hit.point));
            this.measureGroup.add(dot);
            this.pendingPoint = { point: hit.point, dot };
            return;
        }
        const a = this.pendingPoint.point;
        const b = hit.point;
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([this._toScene(a), this._toScene(b)]),
            new THREE.LineBasicMaterial({ color: MEASURE_LINE, depthTest: false }),
        );
        line.renderOrder = 2;
        const end = this._label('measure-dot');
        end.position.copy(this._toScene(b));
        const label = this._label('measure-label');
        label.position.copy(this._toScene(a).add(this._toScene(b)).multiplyScalar(0.5));
        this.measureGroup.add(line, end, label);
        this.measurements.push({ a, b, label });
        this.pendingPoint = null;
        this._syncMeasureLabels(this.project.unit);
    }

    _syncMeasureLabels(unit) {
        for (const { a, b, label } of this.measurements) {
            const m = measure(a, b);
            const parts = [['X', m.dx], ['Y', m.dy], ['Z', m.dz]]
                .filter(([, v]) => v > 0.05)
                .map(([axis, v]) => `${axis} ${formatLength(v, unit)}`);
            label.element.replaceChildren(formatLength(m.distance, unit));
            if (parts.length > 1) {
                const detail = document.createElement('small');
                detail.textContent = parts.join('  ');
                label.element.append(detail);
            }
        }
    }

    // While measuring with a mouse, show what a click would snap to.
    _previewMeasure(ev) {
        const hit = this.measuring && ev.pointerType !== 'touch' && !ev.buttons && this._measurePoint(ev.clientX, ev.clientY);
        this.snapMarker.visible = Boolean(hit);
        if (hit) {
            this.snapMarker.position.copy(this._toScene(hit.point));
            this.snapMarker.element.dataset.kind = hit.kind;
        }
    }

    // Point the camera at all pieces, keeping the current viewing direction.
    frame() {
        const box = bounds(this.project.pieces);
        if (!box) {
            return;
        }
        const s = MM_PER_SCENE_UNIT;
        const min = new THREE.Vector3(box.min.x, box.min.y, box.min.z).divideScalar(s);
        const max = new THREE.Vector3(box.max.x, box.max.y, box.max.z).divideScalar(s);
        const center = min.clone().add(max).multiplyScalar(0.5);
        const radius = Math.max(max.distanceTo(min) / 2, 0.05);
        const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
        const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
        const distance = radius / Math.sin(Math.min(vHalf, hHalf));
        const direction = this.camera.position.clone().sub(this.controls.target).normalize();
        this.controls.target.copy(center);
        this.camera.position.copy(center).addScaledVector(direction, distance * 1.15);
    }

    // Width/height/depth of the selection: a single piece's own size along
    // its (possibly rotated) edges, or the bounding box of a group or
    // several pieces.
    _syncLabels(pieces, unit) {
        const box = pieces.length > 1 && bounds(pieces);
        const extent = pieces.length === 1 ? pieces[0] : box && {
            position: box.min,
            width: box.max.x - box.min.x,
            height: box.max.y - box.min.y,
            depth: box.max.z - box.min.z,
        };
        const anchors = extent && labelAnchors(extent);
        for (const label of this.labels) {
            label.visible = Boolean(extent);
            if (extent) {
                const dim = label.userData.dim;
                label.position.set(...anchors[dim]);
                label.element.textContent = formatLength(extent[dim], unit);
            }
        }
    }

    // ---- theme and shadows ---------------------------------------------------

    setTheme(theme) {
        const look = LOOKS[theme];
        if (!look || theme === this.theme) {
            return;
        }
        this.theme = theme;
        this.scene.background = look.top === look.bottom ? new THREE.Color(look.top) : gradientTexture(look.top, look.bottom);
        this.fill.color.setHex(look.fill[0]);
        this.fill.groundColor.setHex(look.fill[1]);
        this.fill.intensity = look.fill[2];
        this.lamp.color.setHex(look.lamp[0]);
        this.lamp.intensity = look.lamp[1];
        this.floor.material.opacity = look.shadow;
        this.sync();
    }

    setShadows(on) {
        this.renderer.shadowMap.enabled = on;
        this.floor.visible = on;
        // Materials compile differently with shadows; rebuild them.
        this.scene.traverse((object) => {
            if (object.material) {
                object.material.needsUpdate = true;
            }
        });
    }

    // Put the lamp up and to the side of the pieces, and fit its shadow
    // camera around them so the shadow map is spent where it shows.
    _aimLamp() {
        const box = bounds(this.project.pieces);
        const s = MM_PER_SCENE_UNIT;
        const center = box
            ? new THREE.Vector3(box.min.x + box.max.x, box.min.y + box.max.y, box.min.z + box.max.z).divideScalar(2 * s)
            : new THREE.Vector3();
        const radius = box
            ? Math.max(0.3, new THREE.Vector3(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z).length() / (2 * s))
            : 1;
        const from = new THREE.Vector3(...LOOKS[this.theme].lampFrom).normalize();
        this.lamp.target.position.copy(center);
        this.lamp.position.copy(center).addScaledVector(from, radius * 4);
        const camera = this.lamp.shadow.camera;
        camera.left = -radius * 1.6;
        camera.right = radius * 1.6;
        camera.top = radius * 1.6;
        camera.bottom = -radius * 1.6;
        camera.near = radius * 0.5;
        camera.far = radius * 8;
        camera.updateProjectionMatrix();
    }

    // A floor grid in the user's units: 10 cm squares or 1 ft squares.
    _syncGrid(unit) {
        const imperial = Boolean(UNITS[unit].imperial);
        const key = `${imperial}-${this.theme}`;
        if (this.grid && this.grid.userData.key === key) {
            return;
        }
        if (this.grid) {
            this.scene.remove(this.grid);
            this.grid.dispose();
        }
        const cell = (imperial ? UNITS.ft.mmPer : 100) / MM_PER_SCENE_UNIT;
        const cells = imperial ? 16 : 50;
        this.grid = new THREE.GridHelper(cell * cells, cells, ...LOOKS[this.theme].grid);
        this.grid.userData.key = key;
        this.grid.position.y = -0.0005; // just under pieces resting on the floor
        this.scene.add(this.grid);
    }

    _listenForTaps() {
        const canvas = this.renderer.domElement;
        const raycaster = new THREE.Raycaster();
        let down = null;
        let lastTap = null;
        canvas.addEventListener('pointerdown', (ev) => {
            down = { x: ev.clientX, y: ev.clientY };
        });
        canvas.addEventListener('pointermove', (ev) => this._previewMeasure(ev));
        canvas.addEventListener('pointerleave', () => {
            this.snapMarker.visible = false;
        });
        canvas.addEventListener('pointerup', (ev) => {
            if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > CLICK_SLOP) {
                down = null;
                return;
            }
            down = null;
            if (this.measuring) {
                this._measureTap(ev.clientX, ev.clientY);
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const pointer = new THREE.Vector2(
                ((ev.clientX - rect.left) / rect.width) * 2 - 1,
                -((ev.clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(pointer, this.camera);
            const [hit] = raycaster.intersectObjects([...this.meshes.values()], false);
            const pieceId = hit ? hit.object.userData.pieceId : null;
            // Detect double taps ourselves: `dblclick` does not fire for touch.
            const double = Boolean(lastTap && pieceId !== null && lastTap.pieceId === pieceId
                && ev.timeStamp - lastTap.time < DOUBLE_TAP_MS);
            lastTap = double ? null : { pieceId, time: ev.timeStamp };
            pickPiece(this.project, pieceId, { additive: ev.shiftKey || this.multiSelect, double });
        });
    }

    _resize() {
        const { clientWidth: width, clientHeight: height } = this.container;
        if (!width || !height) {
            return;
        }
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        this.labelRenderer.setSize(width, height);
    }
}

// A vertical gradient for the scene background, from `top` to `bottom`.
function gradientTexture(top, bottom) {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, `#${top.toString(16).padStart(6, '0')}`);
    gradient.addColorStop(1, `#${bottom.toString(16).padStart(6, '0')}`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
