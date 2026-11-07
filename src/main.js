import { Project } from './model/project.js';
import { registerServiceWorker } from './pwa.js';
import { bindAutosave, restoreAutosave } from './model/storage.js';
import { Appearance } from './ui/appearance.js';
import { bindKeyboard } from './ui/input.js';
import { Panel } from './ui/panel.js';
import { ViewTools } from './ui/viewTools.js';
import { DesignScene } from './view/scene.js';
import './style.css';

// Set the theme first so the page never shows the wrong colours.
const appearance = Appearance.forWindow();
const project = new Project({ unit: 'in' });
let storage = null;
try {
    storage = window.localStorage;
} catch {
    // Storage blocked: run without auto-save.
}
const restored = restoreAutosave(project, storage);
const scene = new DesignScene(document.getElementById('viewport'), project);
const applyAppearance = () => {
    scene.setTheme(appearance.resolved);
    scene.setShadows(appearance.shadows);
};
applyAppearance();
appearance.onChange(applyAppearance);
const panel = new Panel(document.getElementById('panel'), project, scene, { appearance });
bindKeyboard(window, project, () => panel.step);
new ViewTools(document.getElementById('viewport'), scene);
if (storage) {
    bindAutosave(project, storage);
}
if (restored) {
    scene.frame();
}
registerServiceWorker();
