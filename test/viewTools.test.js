// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewTools } from '../src/ui/viewTools.js';

let scene;
let target;

function fakeScene() {
    const s = {
        measuring: false,
        onMeasuringChange: null,
        clearMeasurements: vi.fn(),
        setMeasuring: vi.fn((on) => {
            s.measuring = on;
            if (s.onMeasuringChange) {
                s.onMeasuringChange(on);
            }
        }),
    };
    return s;
}

const key = (k, props = {}) => {
    const ev = new KeyboardEvent('keydown', { key: k, cancelable: true, ...props });
    target.dispatchEvent(ev);
    return ev;
};
const button = (text) => [...document.querySelectorAll('.view-tools button')].find((b) => b.textContent === text);

beforeEach(() => {
    document.body.innerHTML = '<div id="viewport"></div>';
    scene = fakeScene();
    target = new EventTarget();
    new ViewTools(document.getElementById('viewport'), scene, target);
});

describe('ViewTools', () => {
    it('toggles measuring with the button and shows Clear and a hint while on', () => {
        const extras = document.querySelector('.view-tools-extras');
        expect(extras.hidden).toBe(true);
        button('Measure').click();
        expect(scene.measuring).toBe(true);
        expect(button('Measure').getAttribute('aria-pressed')).toBe('true');
        expect(extras.hidden).toBe(false);
        button('Clear').click();
        expect(scene.clearMeasurements).toHaveBeenCalled();
        button('Measure').click();
        expect(extras.hidden).toBe(true);
    });

    it('toggles with M and stops with Esc', () => {
        expect(key('m').defaultPrevented).toBe(true);
        expect(scene.measuring).toBe(true);
        key('Escape');
        expect(scene.measuring).toBe(false);
        expect(key('Escape').defaultPrevented).toBe(false); // nothing to stop
        key('M');
        expect(scene.measuring).toBe(true);
    });

    it('leaves M alone while typing or with modifiers', () => {
        const input = document.createElement('input');
        document.body.append(input);
        const ev = new KeyboardEvent('keydown', { key: 'm', cancelable: true });
        Object.defineProperty(ev, 'target', { value: input });
        target.dispatchEvent(ev);
        key('m', { ctrlKey: true });
        expect(scene.setMeasuring).not.toHaveBeenCalled();
    });
});
