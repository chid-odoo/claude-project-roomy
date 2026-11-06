import { describe, expect, it } from 'vitest';
import { PX_PER_STEP, scrubValue } from '../src/ui/scrub.js';

describe('scrubValue', () => {
    it('goes up when dragging up and down when dragging down', () => {
        expect(scrubValue(10, -PX_PER_STEP * 3, { step: 1 })).toBe(13);
        expect(scrubValue(10, PX_PER_STEP * 3, { step: 1 })).toBe(7);
    });

    it('changes nothing until a full step is dragged', () => {
        expect(scrubValue(10, -1, { step: 1 })).toBe(10);
    });

    it('moves in whole steps of the given size', () => {
        expect(scrubValue(0, -PX_PER_STEP * 2, { step: 6.35 })).toBe(12.7);
        expect(scrubValue(0, -PX_PER_STEP * 3, { step: 1.5875 })).toBe(4.7625);
    });

    it('is 10x coarser with Shift and 10x finer with Alt', () => {
        expect(scrubValue(0, -PX_PER_STEP, { step: 1, shiftKey: true })).toBe(10);
        expect(scrubValue(0, -PX_PER_STEP * 3, { step: 1, altKey: true })).toBe(0.3);
    });

    it('stops at the minimum', () => {
        expect(scrubValue(5, PX_PER_STEP * 10, { step: 1, min: 1 })).toBe(1);
    });

    it('is measured from where the drag started, so it does not drift', () => {
        const start = 19.05;
        const steps = [-4, -8, -12, -8, -4, 0];
        const values = steps.map((dy) => scrubValue(start, dy, { step: 6.35 }));
        expect(values.at(-1)).toBe(start);
    });
});
