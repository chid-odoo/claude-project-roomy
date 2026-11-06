// Register the service worker (public/sw.js) so the app can be installed and
// used offline. Only in production builds: in `npm run dev` a service worker
// would serve stale files and fight with hot reload.
export function registerServiceWorker(nav = navigator, enabled = import.meta.env.PROD) {
    if (!enabled || !nav || !('serviceWorker' in nav)) {
        return Promise.resolve(null);
    }
    return nav.serviceWorker.register('./sw.js').catch((err) => {
        // Not fatal: the app works without it, just not offline. This happens
        // over plain http on a phone, for example.
        console.warn('Service worker not registered:', err);
        return null;
    });
}
