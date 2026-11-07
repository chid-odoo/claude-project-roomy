// Floating bar at the bottom centre of the 3D view (desktop only) holding
// the selection's size, position and rotation fields. The same field blocks
// live in the side panel on phones; on wider screens they are moved here,
// so there is only ever one copy of each field.
import { el } from './fields.js';

export const DESKTOP_QUERY = '(min-width: 721px)';

export class Inspector {
    // `blocks` are DOM nodes already placed in the side panel, in the order
    // they should appear in the bar.
    constructor(container, blocks, media = window.matchMedia ? window.matchMedia(DESKTOP_QUERY) : null) {
        this.blocks = blocks;
        this.media = media;
        // Markers remember where each block goes back to in the panel.
        this.markers = blocks.map((block) => {
            const marker = document.createComment('inspector slot');
            block.before(marker);
            return marker;
        });
        this.root = el('div', { className: 'inspector', hidden: true });
        this.root.setAttribute('aria-label', 'Selection size, position and rotation');
        container.append(this.root);
        this.visible = false;
        if (media) {
            media.addEventListener('change', () => this._place());
        }
        this._place();
    }

    get desktop() {
        return Boolean(this.media && this.media.matches);
    }

    _place() {
        if (this.desktop) {
            this.root.append(...this.blocks);
        } else {
            this.blocks.forEach((block, i) => this.markers[i].after(block));
        }
        this.show(this.visible);
    }

    // Shown while something is selected (and only on desktop).
    show(visible) {
        this.visible = visible;
        this.root.hidden = !(visible && this.desktop);
    }
}
