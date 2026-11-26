# Mises à jour de Camton Live

Camton Live vérifie une seule fois au démarrage si une version plus récente est annoncée par le manifeste HTTPS `https://github.com/jean47/LogicielCamtonLive-/releases/latest/download/latest.json`, c’est-à-dire l’asset `latest.json` de la dernière release GitHub. L’application ne transmet aucune donnée personnelle pour cette requête. Les erreurs réseau ou l’absence de manifeste n’interrompent pas le démarrage.

Le manifeste `latest.json` suit ce format :

```json
{
  "version": "0.5.0",
  "downloadUrl": "https://github.com/jean47/LogicielCamtonLive-/releases/latest/download/Camton-Live-Setup-0.5.0-x64.exe",
  "sha256": "<64 caractères hexadécimaux du SHA-256 de Camton.exe>",
  "releaseNotes": "Capture écran/fenêtre fiabilisée et textes augmentés de 5 %."
}
```

Pour une version égale ou antérieure à celle installée, `downloadUrl` et `sha256` peuvent être omis. Pour toute version supérieure, les deux champs sont obligatoires. L’URL du manifeste et celle de l’installateur doivent utiliser HTTPS. Le client suit au plus quatre redirections HTTPS, vérifie le SHA-256 avant toute installation et refuse les fichiers de plus de 1 Gio. `releaseNotes` est du texte simple affiché dans l’application.

## Publication d’une future mise à jour

1. Augmenter la version dans `package.json` et dans `package-lock.json`.
2. Construire l’installateur Windows `Camton.exe`.
Pour le build Electron, conserver `base: './'` dans `vite.config.js` : l’application charge `dist/index.html` avec `file://`, et des chemins `/assets/...` absolus ne chargeraient pas le CSS ni le JavaScript.
   Pour la capture d’écran/fenêtre, conserver `electron/display-capture.cjs` et le handler `setDisplayMediaRequestHandler` : il valide à nouveau la source sélectionnée dans Camton Live et refuse les demandes venant d’une origine non approuvée. Ne pas réintroduire l’ancien flux `getUserMedia` avec `chromeMediaSource`.
3. Pousser le tag `v<version>` : `.github/workflows/release.yml` construit le ZIP portable et l’installateur, calcule leurs empreintes, génère `latest.json` à partir de `src/release-notes.json` et dépose le tout en assets de la release. Aucun hébergeur tiers à maintenir.
4. Vérifier que `https://github.com/jean47/LogicielCamtonLive-/releases/latest/download/latest.json` annonce la nouvelle version : c’est la seule adresse interrogée par l’application.

L’utilisateur choisit le moment de téléchargement. Une fois le téléchargement vérifié, il clique sur « Installer et redémarrer »; l’installation est différée tant qu’un direct est en cours. L’installeur NSIS est lancé sans fenêtre interactive, puis Camton Live redémarre avec la nouvelle version. Les anciens installateurs qui ne contiennent pas ce module ne peuvent pas recevoir automatiquement leur toute première mise à jour et devront d’abord être remplacés manuellement par une version qui intègre ce système.
