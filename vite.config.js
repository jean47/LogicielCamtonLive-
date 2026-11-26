import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // Electron charge le build avec file://, donc les assets doivent rester relatifs.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
