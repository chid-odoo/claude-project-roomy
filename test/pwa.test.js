import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../src/pwa.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));

// Width and height from a PNG's IHDR chunk.
function pngSize(path) {
    const data = read(path);
    expect(data.subarray(1, 4).toString()).toBe('PNG');
    return `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`;
}

describe('manifest', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest'));

    it('has what browsers need to offer an install', () => {
        expect(manifest).toMatchObject({ name: 'Roomy', short_name: 'Roomy', display: 'standalone' });
        // Relative, so it works from a sub-folder such as GitHub Pages.
        expect(manifest.start_url).toBe('./');
        expect(manifest.scope).toBe('./');
        const sizes = manifest.icons.filter((icon) => !icon.purpose).map((icon) => icon.sizes);
        expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
        expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    });

    it('points at icons that exist at the stated size', () => {
        for (const icon of manifest.icons) {
            expect(icon.src).not.toMatch(/^\//);
            expect(pngSize(`public/${icon.src}`)).toBe(icon.sizes);
        }
    });
});

describe('index.html', () => {
    const html = read('index.html').toString();

    it('links the manifest and icons that exist in public/', () => {
        const links = [...html.matchAll(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*href="\/([^"]+)"/g)];
        expect(links.map((m) => m[1]).sort()).toEqual(['apple-touch-icon', 'icon', 'manifest']);
        for (const [, , path] of links) {
            expect(() => read(`public/${path}`)).not.toThrow();
        }
        expect(pngSize('public/icons/apple-touch-icon.png')).toBe('180x180');
    });
});

describe('registerServiceWorker', () => {
    it('registers sw.js relative to the page in production', async () => {
        const register = vi.fn().mockResolvedValue('registration');
        await expect(registerServiceWorker({ serviceWorker: { register } }, true)).resolves.toBe('registration');
        expect(register).toHaveBeenCalledWith('./sw.js');
    });

    it('does nothing in development or without service worker support', async () => {
        const register = vi.fn();
        await expect(registerServiceWorker({ serviceWorker: { register } }, false)).resolves.toBeNull();
        await expect(registerServiceWorker({}, true)).resolves.toBeNull();
        expect(register).not.toHaveBeenCalled();
    });

    it('carries on if registration fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const register = vi.fn().mockRejectedValue(new Error('insecure'));
        await expect(registerServiceWorker({ serviceWorker: { register } }, true)).resolves.toBeNull();
    });
});

// Run public/sw.js against fake service-worker globals.
function loadServiceWorker({ network = {}, offline = false } = {}) {
    const origin = 'https://example.test';
    const stores = new Map();
    const keyOf = (request) => new URL(typeof request === 'string' ? request : request.url, `${origin}/app/sw.js`).href;
    const openStore = (name) => {
        if (!stores.has(name)) {
            stores.set(name, new Map());
        }
        const store = stores.get(name);
        return {
            put: async (request, response) => store.set(keyOf(request), response),
            match: async (request) => store.get(keyOf(request)),
            addAll: async (urls) => urls.forEach((url) => store.set(keyOf(url), new Response(`shell ${url}`))),
        };
    };
    const caches = {
        open: async (name) => openStore(name),
        keys: async () => [...stores.keys()],
        delete: async (name) => stores.delete(name),
    };
    const fetchLog = [];
    const fetch = async (request) => {
        const url = keyOf(request);
        fetchLog.push(url);
        if (offline) {
            throw new TypeError('offline');
        }
        return url in network ? new Response(network[url]) : new Response('missing', { status: 404 });
    };
    const listeners = {};
    const self = {
        location: { origin },
        addEventListener: (type, fn) => {
            listeners[type] = fn;
        },
        skipWaiting: vi.fn(),
        clients: { claim: vi.fn() },
    };
    runInNewContext(read('public/sw.js').toString(), { self, caches, fetch, URL, Response, Promise, TypeError });

    const fire = async (type, request) => {
        let result = null;
        const pending = [];
        listeners[type]({
            request,
            waitUntil: (promise) => pending.push(promise),
            respondWith: (promise) => {
                result = promise;
            },
        });
        await Promise.all(pending);
        return result && result.then((response) => response.text());
    };
    const request = (path, { mode = 'cors', method = 'GET' } = {}) => ({ url: new URL(path, origin).href, mode, method });
    return { fire, request, stores, caches, fetchLog, self, origin };
}

describe('service worker', () => {
    it('caches the app shell on install and takes over straight away', async () => {
        const sw = loadServiceWorker();
        await sw.fire('install');
        const shell = [...sw.stores.get('roomy-v1').keys()];
        expect(shell).toContain(`${sw.origin}/app/`);
        expect(shell).toContain(`${sw.origin}/app/icons/icon-512.png`);
        expect(sw.self.skipWaiting).toHaveBeenCalled();
    });

    it('drops caches from older versions on activate', async () => {
        const sw = loadServiceWorker();
        await sw.caches.open('roomy-v0');
        await sw.caches.open('something-else');
        await sw.fire('activate');
        expect([...sw.stores.keys()]).toEqual(['something-else']);
        expect(sw.self.clients.claim).toHaveBeenCalled();
    });

    it('loads pages from the network first and keeps the copy for offline', async () => {
        const online = loadServiceWorker({ network: { 'https://example.test/app/': 'new page' } });
        await expect(online.fire('fetch', online.request('/app/', { mode: 'navigate' }))).resolves.toBe('new page');

        const offline = loadServiceWorker({ offline: true });
        await offline.fire('install');
        await expect(offline.fire('fetch', offline.request('/app/?x=1', { mode: 'navigate' }))).resolves.toBe('shell ./');
    });

    it('serves built files from the cache after the first fetch', async () => {
        const url = 'https://example.test/app/assets/index-abc.js';
        const sw = loadServiceWorker({ network: { [url]: 'code' } });
        await expect(sw.fire('fetch', sw.request(url))).resolves.toBe('code');
        await expect(sw.fire('fetch', sw.request(url))).resolves.toBe('code');
        expect(sw.fetchLog.filter((u) => u === url)).toHaveLength(1);
    });

    it('does not cache failed responses', async () => {
        const sw = loadServiceWorker();
        await sw.fire('fetch', sw.request('/app/missing.js'));
        await sw.fire('fetch', sw.request('/app/missing.js'));
        expect(sw.fetchLog).toHaveLength(2);
    });

    it('leaves other sites and non-GET requests to the browser', async () => {
        const sw = loadServiceWorker();
        await expect(sw.fire('fetch', sw.request('https://cdn.example.com/x.js'))).resolves.toBeNull();
        await expect(sw.fire('fetch', sw.request('/app/save', { method: 'POST' }))).resolves.toBeNull();
        expect(sw.fetchLog).toEqual([]);
    });
});
