# Camton Live — bêta de bureau Windows

<p align="center"><img src="public/camton-live-logo.png" alt="Logo Camton Live" width="280" /></p>

Camton Live est un studio de streaming en français qui s’ouvre dans sa propre fenêtre Windows. La bêta 0.4 cible Windows x64 et diffuse vers Twitch et YouTube avec les clés et paramètres fournis par l’utilisateur.

## Ouvrir l’application Windows

Décompresse `Camton-Live-Portable-0.4.3-x64.zip`, puis lance `Camton Live.exe` depuis le dossier extrait. C’est une application portable, pas un installateur `Setup.exe`. L’exécutable n’étant pas signé, Windows peut afficher SmartScreen. Le paquet comprend FFmpeg et ses composants LGPL partagés, avec les avis de licence dans `resources/licenses/`.

## Configurer une destination

Pour Twitch, ouvre les paramètres de diffusion de ta chaîne et copie uniquement ta clé de stream dans Camton Live. Pour YouTube, crée ou sélectionne ton événement dans YouTube Studio, puis copie l’adresse du serveur d’ingestion et la clé affichées par Studio. Camton Live chiffre ces valeurs dans le stockage local protégé du système Windows. Les mots de passe YouTube/Twitch ne sont jamais demandés. Pour effacer une clé, utilise le bouton de suppression dans la configuration de la plateforme.

Pendant un direct, l’adresse d’ingestion avec la clé est transmise à FFmpeg; un outil local d’inspection des processus peut donc la voir pendant l’exécution. Protège ta session Windows et ne partage pas le compte avec des personnes non fiables. Camton Live ne la révèle pas dans son interface ou ses journaux et elle est chiffrée lorsqu’elle est stockée.

La bêta n’utilise pas OAuth et ne crée pas d’événement YouTube. Camton Live distingue la connexion et l’encodage local, mais ne peut pas confirmer que la plateforme reçoit ou diffuse effectivement le flux. Vérifie la réception et l’état de l’événement dans Twitch ou YouTube Studio; selon les réglages, YouTube peut nécessiter un événement déjà créé et démarré. TikTok LIVE n’est pas disponible.

## Sources et audio

Sur PC, choisis un écran, une fenêtre ou un jeu dans le sélecteur de partage intégré. Pour la Xbox, relie sa sortie HDMI à l’entrée d’une carte de capture compatible, puis branche la carte en USB sur le PC. Le câble HDMI seul ne relie généralement pas directement la Xbox au PC.

Le lancement réel demande une vidéo et un microphone. Le son de la source est mélangé au micro lorsqu’il est fourni par Windows ou la carte. La disponibilité du son de bureau et la compatibilité des cartes dépendent des pilotes et de la configuration. Un aperçu seul n’envoie pas de flux à une plateforme.

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

L’interface vit dans `index.html`, `src/main.js` et `src/styles/` (jetons, base, mise en page, composants). Le moteur de bureau reste dans `electron/` et ses tests dans `electron/*.test.cjs`.

Pour télécharger la build FFmpeg Windows x64 épinglée puis reconstruire le ZIP portable :

```bash
npm run desktop:win
```

Le ZIP est produit dans `release/`. Il est également possible d’exécuter l’interface seule avec `npm run dev`; dans ce mode navigateur, la configuration sécurisée des clés et le moteur de diffusion sont désactivés.
