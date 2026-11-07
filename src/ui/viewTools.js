// Tools floating over the 3D view (top left): the measuring tool for now.
// M toggles measuring, Esc stops it; leaving measure mode clears the
// measurements.
import { el } from './fields.js';

const EDITABLE = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

export class ViewTools {
    constructor(container, scene, keyTarget = window) {
        this.scene = scene;
        this.measureButton = el('button', { type: 'button', className: 'secondary small', textContent: 'Measure', title: 'Measure (M)' });
        this.measureButton.addEventListener('click', () => scene.setMeasuring(!scene.measuring));
        const clear = el('button', { type: 'button', className: 'secondary small', textContent: 'Clear' });
        clear.addEventListener('click', () => scene.clearMeasurements());
        this.hint = el('span', { className: 'view-tools-hint', textContent: 'Click two points. Snaps to corners and edges. Esc to stop.' });
        this.measureExtras = el('span', { className: 'view-tools-extras', hidden: true }, [clear, this.hint]);
        this.root = el('div', { className: 'view-tools' }, [this.measureButton, this.measureExtras]);
        container.append(this.root);

        scene.onMeasuringChange = () => this.render();
        keyTarget.addEventListener('keydown', (ev) => {
            if (EDITABLE.has(ev.target.tagName) || ev.ctrlKey || ev.metaKey || ev.altKey) {
                return;
            }
            if (ev.key === 'm' || ev.key === 'M') {
                scene.setMeasuring(!scene.measuring);
                ev.preventDefault();
            } else if (ev.key === 'Escape' && scene.measuring) {
                scene.setMeasuring(false);
                ev.preventDefault();
            }
        });
        this.render();
    }

    render() {
        const on = this.scene.measuring;
        this.measureButton.classList.toggle('active', on);
        this.measureButton.setAttribute('aria-pressed', String(on));
        this.measureExtras.hidden = !on;
    }
}
