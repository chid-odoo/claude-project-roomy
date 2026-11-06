import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// `--mode https` serves over HTTPS with the certificate from
// `npm run cert` (see scripts/make-cert.sh), for installing on a phone.
function httpsOptions(mode) {
    if (mode !== 'https') {
        return undefined;
    }
    const cert = new URL('./.cert/cert.pem', import.meta.url);
    const key = new URL('./.cert/key.pem', import.meta.url);
    if (!existsSync(cert) || !existsSync(key)) {
        throw new Error('No HTTPS certificate yet: run `npm run cert` first.');
    }
    return { cert: readFileSync(cert), key: readFileSync(key) };
}

export default defineConfig(({ mode }) => ({
    // Relative asset paths so the build works from any folder on a static
    // host, including a GitHub Pages project site (user.github.io/roomy/).
    base: './',
    server: { https: httpsOptions(mode) },
    preview: { https: httpsOptions(mode) },
    test: {
        include: ['test/**/*.test.js'],
    },
}));
