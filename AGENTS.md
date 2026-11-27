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
- `electron/speed-test.cjs` — mesure du débit montant par envoi POST vers Cloudflare (`fetch` injectable) ; le verdict textuel vit côté interface dans `src/speed-verdict.js`.
- `electron/bug-report.cjs` — rapport local sur le Bureau + issue GitHub préremplie ; `redactIngestUrls` masque la clé dans le dernier segment de toute adresse RTMP(S).

## Conventions

- Textes d’interface en français, ton direct, pas de promesse de « live confirmé » : on parle d’encodage local.
- Les classes d’état basculées par le JS sont `active`, `selected`, `hidden`, `show`, `open`, `visible`, `on`, `done` — ne pas les renommer sans toucher `src/main.js`.
- Les identifiants (`#startLiveBtn`, `#micLevel`, …) sont le contrat entre le HTML et le renderer.
- `stream-engine.cjs` émet `{ type: 'stats', … }` une fois par seconde à partir de `-progress pipe:1` (débit, fps, images perdues) ; le renderer ne rafraîchit que la ligne de statistiques, pas le badge.
- `MAX_DESTINATIONS` vaut 4 dans `stream-engine.cjs` : les tests couvrent l'acceptation de quatre sorties et le refus de la cinquième.
- `stream-engine.cjs` accepte un objet `deps` (`spawn`, `platform`, `arch`, `resolveExecutable`) uniquement pour les tests : la production garde les valeurs par défaut.

## Pièges connus

- Le moteur refuse de démarrer hors Windows x64 : les tests injectent `deps.platform`.
- Les tests du moteur utilisent un faux FFmpeg en shell réel (pas de mock de comportement) qui expose `-encoders` puis draine stdin.
- `npm run ffmpeg:fetch` pointe sur `scripts/` (pluriel) : ne pas recréer un dossier `script/`.
- `vite.config.js` doit garder `base: './'` : Electron charge `dist/index.html` en `file://`.

## Packaging

- `npm run desktop:win` produit `release/Camton-Live-Portable-<version>-x64.zip` (cible `zip`, pas d'installeur).
- L'extraction du ZIP FFmpeg est faite en Node pur (`zlib.inflateRawSync`) : ne pas réintroduire d'appel à `unzip`/`tar`, absents par défaut sous Windows.
- `vendor/ffmpeg/win-x64/` et `release/` sont ignorés par git : jamais committés.

## Audio

- `src/audio-mixer.js` : graphe Web Audio et logique pure (`resolveTrackGains`, `clampVolume`, `levelPercent`). Un seul `AudioContext` pour toute l’application ; ne pas recréer un contexte par vu-mètre.
- `src/audio-desk.js` : pistes, interface, capture micro/musique et persistance (`localStorage` → `camton-mixer`).
- `main.js` ne fait que relayer : `setSourceStream()` à l’aperçu, `ensurePrimaryMic()` + `getOutputStream()` au démarrage du direct, `releaseCaptures()` à l’arrêt.

## Nouveautés et publication

- `src/release-notes.json` doit porter la même version que `package.json` (test dédié dans `src/whats-new.test.js`).
- À chaque version publiée : le manifeste `latest.json` (version, `downloadUrl`, `sha256`, `releaseNotes`) est généré par `release.yml` et déposé en asset de la release. L’application n’interroge que `releases/latest/download/latest.json` : pas de second hébergement à maintenir.
- `docs/guide-destinations.md` et `docs/faq.md` sont les versions publiables du guide (« où trouver quoi » pour Twitch, YouTube, TikTok) et de la FAQ. L’application embarque le même contenu dans `openGuide()` / `openFaq()` : toute correction doit être reportée aux deux endroits.
- Destinations : `twitch` (clé seule), `youtube`, `tiktok` et `relay` (adresse RTMP(S) + clé). Le relais est une sortie générique vers Restream, Streamlabs ou un serveur RTMP personnel : même chemin que TikTok, sans validation d’hôte. Une destination se déclare dans `src/platforms.js`, `index.html` (carte), `electron/secret-store.cjs` (`SUPPORTED` + validation) et `electron/stream-engine.cjs` (`destinationFor` + liste blanche). La clé TikTok est liée à une session : elle est recopiée à chaque direct.

## Signature Windows

- Tout binaire distribué est signé quand un certificat est configuré, et le build reste identique sans certificat : `scripts/sign-windows.mjs` ne fait rien si `WINDOWS_CERT_PFX_PATH` / `WINDOWS_CERT_PFX_BASE64` sont absents.
- Trois binaires, dans cet ordre : `Camton Live.exe` et `ffmpeg.exe` via le point d'entrée `afterPack` d'electron-builder (donc **avant** le ZIP), puis `Camton-Live-Setup-<version>-x64.exe` à la fin de `scripts/build-installer.mjs`. Signer après la fabrication de l'archive ne signe rien.
- Secrets GitHub attendus pour la CI : `WINDOWS_CERT_PFX` (le `.pfx` encodé en base64) et `WINDOWS_CERT_PASSWORD`. `signtool.exe` vient du SDK Windows, présent sur `windows-latest` ; sinon `SIGNTOOL=/chemin/vers/signtool.exe`.
- **Sans société, donc sans certificat exportable** : les autorités livrent la clé sur token depuis juin 2023, et un token ne se branche pas dans une machine GitHub. La voie est la signature sur le poste : `WINDOWS_CERT_SHA1` (empreinte du certificat, `WINDOWS_CERT_STORE=machine` si magasin machine), puis `npm run sign:local` et `npm run sign:verify`.
- `npm run release:win` enchaîne : construction, signature, vérification, puis `scripts/publish-release.mjs`. Ce dernier crée la release **et son tag** sans pousser de tag : la CI ne reconstruit donc pas par-dessus des binaires déjà signés. Si la release existe déjà, `publier.sh` s'arrête proprement.
- Horodatage RFC 3161 obligatoire (`/tr`), sinon la signature meurt avec le certificat.
- C'est la réputation du **certificat** qui fait taire SmartScreen, pas le fichier : garder le même certificat d'une version à l'autre. Un certificat EV vaut confiance immédiate, un OV se construit par téléchargements.
- Alternative sans token matériel : Azure Artifact Signing (ex-Trusted Signing), réservé aux organisations de l'UE, du Royaume-Uni, des États-Unis, du Canada, de l'Australie, de la Nouvelle-Zélande, du Japon, de la Corée du Sud, de Singapour, de la Suisse, de la Norvège et d'Israël ; un particulier n'y est éligible qu'aux États-Unis ou au Canada. La CI n'est pas câblée pour cette voie : il faudrait remplacer `signtool sign /f` par `signtool sign /dlib /dmdf`.

## Installateur Windows

- `installer/setup.nsi` + `scripts/build-installer.mjs` remplacent la cible `nsis` d’electron-builder, qui exige Wine sous Linux. `makensis` s’exécute nativement ; sous Linux il faut exporter `NSISDIR` vers la racine de la distribution (fait par le script).
- Installation par utilisateur dans `%LOCALAPPDATA%\Programs\Camton Live` (`RequestExecutionLevel user`), avec `/S` pour la mise à jour silencieuse et `taskkill` de l’instance en cours avant la copie.
- `release/` contient `Camton-Live-Setup-<version>-x64.exe` et `Camton-Live-Portable-<version>-x64.zip`. L’installateur doit être reconstruit après tout changement de `dist/`, puis son SHA-256 reporté par le manifeste de la release.

## Publication

- `scripts/publish-update.mjs` : source de vérité du manifeste (`updates/latest.json`, recopié dans `dist-update/`). Il relit `src/release-notes.json`, recalcule le SHA-256 de `release/Camton-Live-Setup-<version>-x64.exe` et assemble `dist-update/`. Sans `--execute`, il n’envoie rien.
- `PUBLISH_URL_BASE` est obligatoire et fixe le dossier public du manifeste ; `{dir}` dans `PUBLISH_CMD` est remplacé par `dist-update/`.
- `.github/workflows/release.yml` : tag `v*` → tests, ZIP, Setup.exe, manifeste, release. Utilise `releases/latest/download/` pour l’adresse du manifeste.
- **Le tag et la release se créent toujours dans un job direct.** Un workflow réutilisable (`workflow_call`) reçoit un jeton qui peut créer un brouillon mais **pas un tag** : `gh release create --target` échoue en `403 Resource not accessible by integration`, même avec `permissions: contents: write` et le dépôt réglé en « Read and write ». D’où le découpage : `windows` construit et archive `camton-build`, puis un job `publier` (direct) télécharge l’artefact et appelle `.github/actions/publier-release`, qui crée le tag puis la release. Le dossier d’accueil est `release-files/`, pas `build/` (qui contient les icônes du dépôt).
- **Publier sans demander** : après un correctif livrable, incrémenter la version, pousser le tag et vérifier la release. Attendre seulement si la demande est explicite.
- **Publier = pousser le tag** : `git tag vX.Y.Z <cible> && git push origin vX.Y.Z`. L'événement `push` est le seul contexte où le jeton du workflow peut créer un tag. Une publication différée avait été tentée (`publish-0-5-*.yml`, jobs `garde`/`publish`/`publier`) puis abandonnée : même un job direct d'un workflow qui appelle `release.yml` reçoit un jeton incapable de créer un tag (`403 Resource not accessible by integration`), y compris avec `permissions: contents: write` et le dépôt réglé en « Read and write ». Le garde-fou reste utile en local : `bash .github/scripts/guard-release.sh`. La 0.5.1 a été abandonnée pour ne pas publier deux fois un installateur sans le correctif de mise à jour. Le job `garde` appelle `.github/scripts/guard-release.sh`, qui échoue si la cible est introuvable, hors de la branche, en version différente du tag, si le tag existe déjà, ou si du code livré a changé depuis la cible alors que la version n’a pas bougé. Une branche passée à une version supérieure est acceptée : les changements plus récents partent dans la publication suivante.
- Une version 0.x reste une **bêta** : titre de release suffixé « — bêta », `IS_BETA` piloté par la version, et `index.html` ne doit jamais figer un numéro (test dans `src/whats-new.test.js`).
