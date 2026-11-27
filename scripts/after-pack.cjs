const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');

// electron-builder appelle ce point d'entrée après le dépaquetage et avant la
// fabrication du ZIP : c'est le seul moment où l'on peut signer l'exécutable
// avant qu'il soit enfermé dans l'archive.
module.exports = async function afterPack(context) {
  const { signFiles } = await import('./sign-windows.mjs');
  const appOutDir = context?.appOutDir;
  if (!appOutDir) return;

  const productName = context?.packager?.appInfo?.productName || 'Camton Live';
  const files = [path.join(appOutDir, `${productName}.exe`)];

  const ffmpegBin = path.join(appOutDir, 'resources', 'ffmpeg', 'bin');
  if (existsSync(ffmpegBin)) {
    for (const entry of readdirSync(ffmpegBin)) {
      if (entry.toLowerCase().endsWith('.exe')) files.push(path.join(ffmpegBin, entry));
    }
  }

  await signFiles(files);
};
