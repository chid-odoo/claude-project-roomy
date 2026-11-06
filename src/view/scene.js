import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { formatLength, UNITS } from '../model/units.js';
import { pickPiece } from '../ui/input.js';
import { bounds, labelAnchors, MM_PER_SCENE_UNIT, pieceTransform } from './transform.js';

const WOOD = 0xd8b88a;
const WOOD_SELECTED = 0x8fbfe8;
const EDGE = 0x5a4630;
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

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.domElement.className = 'label-layer';
        container.appendChild(this.labelRenderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf2f0eb);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(2, 4, 3);
        this.scene.add(sun);

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

        this._listenForTaps();
        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(container);
        this._resize();

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
                this.scene.add(mesh);
                this.meshes.set(piece.id, mesh);
            }
            const { scale, center, rotation } = pieceTransform(piece);
            mesh.scale.set(...scale);
            mesh.position.set(...center);
            mesh.rotation.set(...rotation);
            mesh.material.color.setHex(selectedIds.has(piece.id) ? WOOD_SELECTED : WOOD);
        }
        this._syncLabels(selected, unit);
        this._syncGrid(unit);
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

    // A floor grid in the user's units: 10 cm squares or 1 ft squares.
    _syncGrid(unit) {
        const imperial = Boolean(UNITS[unit].imperial);
        if (this.grid && this.grid.userData.imperial === imperial) {
            return;
        }
        if (this.grid) {
            this.scene.remove(this.grid);
            this.grid.dispose();
        }
        const cell = (imperial ? UNITS.ft.mmPer : 100) / MM_PER_SCENE_UNIT;
        const cells = imperial ? 16 : 50;
        this.grid = new THREE.GridHelper(cell * cells, cells, 0xb5ada0, 0xd6d0c4);
        this.grid.userData.imperial = imperial;
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
        canvas.addEventListener('pointerup', (ev) => {
            if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > CLICK_SLOP) {
                down = null;
                return;
            }
            down = null;
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
