# Camton Live — bêta de bureau Windows

<p align="center"><img src="public/camton-live-logo.png" alt="Logo Camton Live" width="280" /></p>

Camton Live est un studio de streaming en français qui s’ouvre dans sa propre fenêtre Windows. La bêta 0.4 cible Windows x64 et diffuse vers Twitch et YouTube avec les clés et paramètres fournis par l’utilisateur.

## Ouvrir l’application Windows

Deux formats sont livrés :

- **`Camton-Live-Setup-0.4.6-x64.exe`** (recommandé) : installation par utilisateur dans `%LOCALAPPDATA%\Programs\Camton Live`, sans droits administrateur. Raccourcis sur le bureau et dans le menu Démarrer, désinstallation propre, prise en charge de l’installation silencieuse (`/S`) utilisée par les mises à jour.
- **`Camton-Live-Portable-0.4.6-x64.zip`** : décompresse l’archive, puis lance `Camton Live.exe`. À garder dans son dossier, pas seul sur le bureau.

Les deux versions partagent les mêmes réglages (mêmes identifiants d’application), donc installer la 0.4.6 par-dessus une version portable conserve ton mixage et tes clés. Les exécutables ne sont pas signés : Windows peut afficher SmartScreen (« Informations complémentaires » puis « Exécuter quand même »). Le paquet comprend FFmpeg et ses composants LGPL partagés, avec les avis de licence dans `resources/licenses/`. L’encodeur H.264 est choisi au démarrage parmi NVIDIA NVENC, Intel Quick Sync, AMD AMF et Media Foundation, chacun validé par un encodage d’essai.

## Configurer une destination

Pour Twitch, ouvre les paramètres de diffusion de ta chaîne et copie uniquement ta clé de stream dans Camton Live. Pour YouTube, crée ou sélectionne ton événement dans YouTube Studio, puis copie l’adresse du serveur d’ingestion et la clé affichées par Studio. Camton Live chiffre ces valeurs dans le stockage local protégé du système Windows. Les mots de passe YouTube/Twitch ne sont jamais demandés. Pour effacer une clé, utilise le bouton de suppression dans la configuration de la plateforme.

Pendant un direct, l’adresse d’ingestion avec la clé est transmise à FFmpeg; un outil local d’inspection des processus peut donc la voir pendant l’exécution. Protège ta session Windows et ne partage pas le compte avec des personnes non fiables. Camton Live ne la révèle pas dans son interface ou ses journaux et elle est chiffrée lorsqu’elle est stockée.

La bêta n’utilise pas OAuth et ne crée pas d’événement YouTube. Camton Live distingue la connexion et l’encodage local, mais ne peut pas confirmer que la plateforme reçoit ou diffuse effectivement le flux. Vérifie la réception et l’état de l’événement dans Twitch ou YouTube Studio; selon les réglages, YouTube peut nécessiter un événement déjà créé et démarré. TikTok LIVE n’est pas disponible.

## Sources et audio

Sur PC, choisis un écran, une fenêtre ou un jeu dans le sélecteur de partage intégré. Pour la Xbox, relie sa sortie HDMI à l’entrée d’une carte de capture compatible, puis branche la carte en USB sur le PC. Le câble HDMI seul ne relie généralement pas directement la Xbox au PC.

Le lancement réel demande une vidéo et un microphone. Le son de la source est mélangé au micro lorsqu’il est fourni par Windows ou la carte. La disponibilité du son de bureau et la compatibilité des cartes dépendent des pilotes et de la configuration. Un aperçu seul n’envoie pas de flux à une plateforme.

### Table de mixage

La section « Son & micro » contient une table de mixage à plusieurs pistes :

- **Micro principal** : obligatoire pour démarrer, avec choix de l’appareil dans la piste.
- **Second micro** : pour un invité, un casque ou un micro d’appoint.
- **Son de la source** : ajouté automatiquement dès qu’un aperçu qui contient du son est actif.
- **Musique** : un fichier audio local, joué en boucle.

Chaque piste a son bouton d’activation, son volume, son muet (`M`), son solo (`S`) et son vu-mètre. Le solo coupe les autres pistes ; une piste muette le reste même en solo. Le bloc **Master** règle le volume général et coupe tout le direct d’un seul bouton. Les réglages de volume, muet et solo sont mémorisés d’une session à l’autre, et tout le mixage passe par un seul contexte audio pour l’application.

## Qualité, multistream et limites

Les profils Fluide, Équilibré et Très net règlent la résolution, la cadence et le débit de l’encodeur. Diffuser sur deux plateformes utilise davantage de processeur et additionne les débits montant. Commence par un profil modeste et vérifie que ton réseau a assez de marge.

Le paquet vérifie que FFmpeg expose l’encodeur Windows Media Foundation H.264 (`h264_mf`) et l’audio AAC avant de lancer une sortie. Si l’un manque, Camton Live refuse de prétendre diffuser et affiche une erreur. L’encodeur Media Foundation, les pilotes, les cartes de capture et les éditions particulières de Windows doivent être validés sur la machine utilisée.

Une clé valide, une chaîne autorisée à diffuser, un événement configuré, Windows compatible, un pilote fonctionnel et une connexion stable restent nécessaires. La bêta n’est pas testée sur tous les PC, cartes de capture, comptes ou réseaux; elle ne promet donc pas un résultat universel.

## Développer ou reconstruire

Prérequis : Node.js et npm.

```bash
npm ci
npm run desktop:dev   # interface + Electron
npm test              # tests du moteur (node:test)
npm run build         # build Vite de l’interface
```

L’interface vit dans `index.html`, `src/main.js` et `src/styles/` (jetons, base, mise en page, composants). Le moteur de bureau reste dans `electron/`. Les tests couvrent le moteur (`electron/*.test.cjs`) et la logique de l’interface (`src/*.test.js`) : mixage audio (`src/audio-mixer.js`) et nouveautés (`src/whats-new.js`).

Pour télécharger la build FFmpeg Windows x64 épinglée puis reconstruire le ZIP portable :

```bash
npm run desktop:win
```

Deux fichiers sortent dans `release/` : le ZIP portable et `Camton-Live-Setup-<version>-x64.exe`. L’installateur est compilé par `npm run installer:win` avec `makensis` (fourni par NSIS) et le script `installer/setup.nsi` ; la cible `nsis` d’electron-builder n’est pas utilisée car elle exige Wine hors Windows. Il est également possible d’exécuter l’interface seule avec `npm run dev`; dans ce mode navigateur, la configuration sécurisée des clés et le moteur de diffusion sont désactivés.

## Automatiser la publication

### Une commande, en local

```bash
PUBLISH_URL_BASE=https://streamfacile-m7dasb9x.manus.space/updates npm run publish:update
```

`scripts/publish-update.mjs` vérifie que `src/release-notes.json` porte la version de `package.json`, recalcule le SHA-256 de l’installateur, réécrit `updates/latest.json` et assemble `dist-update/` (installateur, ZIP, manifeste, empreintes). Rien n’est envoyé sans `--execute`. Pour envoyer automatiquement, ajoute la commande de ton hébergeur :

```bash
PUBLISH_URL_BASE=https://exemple.com/updates \
PUBLISH_CMD="rclone copy {dir} remote:camton-live/updates" \
npm run publish:update -- --execute
```

`{dir}` est remplacé par le dossier absolu. La même variable accepte `scp`, `lftp`, `curl -T`, un script maison, etc. Pour enchaîner la construction complète : `npm run desktop:win` s’arrête après la préparation du manifeste.

### Entièrement automatique, via GitHub Actions

`.github/workflows/release.yml` construit et publie tout à chaque tag : tests, ZIP portable, `Setup.exe` (NSIS installé par Chocolatey, donc sans Wine), manifeste signé par son empreinte, puis une release GitHub contenant les quatre fichiers. Le manifeste y est servi à une adresse stable, sans commit supplémentaire :

```
https://github.com/jean47/LogicielCamtonLive-/releases/latest/download/latest.json
```

Le dépôt est `jean47/LogicielCamtonLive-` et `UPDATE_MANIFEST_URL` pointe déjà sur cette adresse. Pour publier une version :

```bash
npm version 0.4.6 --no-git-tag-version   # ou modifie package.json et src/release-notes.json
git commit -am "Camton Live 0.4.6"
git tag v0.4.6 && git push origin main --tags
```

C’est le tag qui déclenche tout. Le contrôle `Tag = version` empêche de publier une version dont les numéros divergent, et `src/whats-new.test.js` empêche de livrer des nouveautés obsolètes.

## Publier une mise à jour

Deux fichiers doivent être publiés à chaque version :

1. **`updates/latest.json`** — le manifeste lu en ligne par l’application : `version`, `downloadUrl`, `sha256` et `releaseNotes`. C’est le fichier à déposer sur l’hébergement du manifeste (`https://streamfacile-m7dasb9x.manus.space/updates/latest.json`). Le champ `releaseNotes` peut contenir plusieurs lignes ; chaque ligne devient une puce dans le pop-up. Le `sha256` doit être celui de l’installateur publié, sinon l’application refuse le fichier.
2. **`src/release-notes.json`** — les nouveautés embarquées dans le paquet. Elles s’affichent dans le pop-up « Quoi de neuf » au premier lancement d’une nouvelle version, puis une seule fois par version installée.

Le test `src/whats-new.test.js` vérifie que `src/release-notes.json` porte exactement la version de `package.json`, ce qui empêche de livrer une version avec les notes de la précédente.

Quand une mise à jour est détectée, le bandeau affiche aussi un bouton « Nouveautés » qui ouvre le même pop-up à partir des `releaseNotes` du manifeste publié.
