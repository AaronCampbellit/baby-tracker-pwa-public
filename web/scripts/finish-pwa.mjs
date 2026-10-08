import {rename} from 'node:fs/promises';
await rename('dist/pwa/pwa.html','dist/pwa/index.html');
