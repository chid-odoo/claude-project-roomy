// Click-and-drag ("scrub") editing of number fields: drag up to increase,
// down to decrease. Shift = 10x coarser, Alt = 10x finer.

export const PX_PER_STEP = 4;
const DRAG_THRESHOLD = 3; // px before a press turns into a drag

// Value after dragging `dy` px (positive = down) from `start`.
export function scrubValue(start, dy, { step, shiftKey = false, altKey = false, min = -Infinity }) {
    const factor = shiftKey ? 10 : altKey ? 0.1 : 1;
    const steps = Math.round(-dy / PX_PER_STEP);
    const value = start + steps * step * factor;
    // Round off float noise (0.1 + 0.2) without losing 1/16" steps.
    return Math.max(min, Math.round(value * 1e6) / 1e6);
}

// Make `handle` scrub a value. `options`:
//   getValue(), setValue(value), getStep(), min,
//   touch: also scrub with touch (the handle must not need to scroll),
//   onClick(): called on a press that did not turn into a drag,
//   onStart() / onEnd(): around a drag (used to make it one undo step).
export function makeScrubbable(handle, options) {
    let drag = null;

    handle.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0 || (ev.pointerType === 'touch' && !options.touch)) {
            return;
        }
        drag = { id: ev.pointerId, y: ev.clientY, start: options.getValue(), moved: false };
    });

    handle.addEventListener('pointermove', (ev) => {
        if (!drag || ev.pointerId !== drag.id) {
            return;
        }
        const dy = ev.clientY - drag.y;
        if (!drag.moved && Math.abs(dy) < DRAG_THRESHOLD) {
            return;
        }
        if (!drag.moved) {
            drag.moved = true;
            handle.setPointerCapture(ev.pointerId);
            document.body.classList.add('scrubbing');
            if (options.onStart) {
                options.onStart();
            }
        }
        ev.preventDefault();
        const value = scrubValue(drag.start, dy, {
            step: options.getStep(),
            shiftKey: ev.shiftKey,
            altKey: ev.altKey,
            min: options.min,
        });
        options.setValue(value);
    });

    const end = (ev) => {
        if (!drag || ev.pointerId !== drag.id) {
            return;
        }
        const { moved } = drag;
        drag = null;
        document.body.classList.remove('scrubbing');
        if (moved && options.onEnd) {
            options.onEnd();
        }
        if (!moved && ev.type === 'pointerup' && options.onClick) {
            options.onClick();
        }
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
}
