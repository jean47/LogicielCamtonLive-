# Camton Live — repères pour les agents

## Stack

Electron 45 (CommonJS) + interface Vite 6 en modules ES. Aucun backend : la page publiée n’est qu’un aperçu, tout ce qui touche aux clés ou à l’encodeur vit dans l’application de bureau.

## Commandes

```bash
npm ci                 # dépendances (lockfile committé)
npm test               # node:test sur electron/*.test.cjs
npm run build          # build Vite dans dist/
npm run desktop:dev    # Vite + Electron (nécessite Windows pour le moteur)
npm run desktop:win    # ffmpeg:fetch + build + electron-builder (ZIP portable)
```

## Carte du code

- `index.html` — structure de l’écran Studio (identifiants stables consommés par `src/main.js`).
- `src/main.js` — tout l’état et les interactions du renderer (sélection de source, mixage, `MediaRecorder`, démarrage/arrêt).
- `src/platforms.js` — profils de qualité et libellés des destinations.
- `src/styles/` — `tokens.css` (palette, échelles), `base.css`, `layout.css`, `components.css`, agrégés par `index.css`.
- `electron/main.cjs` — fenêtre, permissions, IPC validé par origine (`handleTrusted`).
- `electron/secret-store.cjs` — chiffrement `safeStorage`, le renderer ne lit jamais une clé.
- `electron/stream-engine.cjs` — un processus FFmpeg par destination, rétropression, états par sortie.
- `electron/display-capture.cjs` — `setDisplayMediaRequestHandler` et revalidation de la source.
- `electron/update-service.cjs` — manifeste HTTPS, vérification SHA-256, installation différée pendant un direct.

## Conventions

- Textes d’interface en français, ton direct, pas de promesse de « live confirmé » : on parle d’encodage local.
- Les classes d’état basculées par le JS sont `active`, `selected`, `hidden`, `show`, `open`, `visible`, `on`, `done` — ne pas les renommer sans toucher `src/main.js`.
- Les identifiants (`#startLiveBtn`, `#micLevel`, …) sont le contrat entre le HTML et le renderer.
- `stream-engine.cjs` accepte un objet `deps` (`spawn`, `platform`, `arch`, `resolveExecutable`) uniquement pour les tests : la production garde les valeurs par défaut.

## Pièges connus

- Le moteur refuse de démarrer hors Windows x64 : les tests injectent `deps.platform`.
- Les tests du moteur utilisent un faux FFmpeg en shell réel (pas de mock de comportement) qui expose `-encoders` puis draine stdin.
- `npm run ffmpeg:fetch` pointe sur `scripts/` (pluriel) : ne pas recréer un dossier `script/`.
- `vite.config.js` doit garder `base: './'` : Electron charge `dist/index.html` en `file://`.
