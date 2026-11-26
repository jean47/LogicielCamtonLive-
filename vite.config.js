import { defineConfig } from 'vite';

export default defineConfig({
  // Electron charge le build avec file://, donc les assets doivent rester relatifs.
  base: './',
});
