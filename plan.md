# Plan — Camton Live 0.4 pour Windows

## Objectif et portée

Faire de l’application **Camton Live** une bêta Windows x64 qui capture une source PC ou une carte HDMI USB, mélange l’audio disponible de la source et un micro, encode le flux et l’envoie réellement vers Twitch et/ou l’ingestion YouTube. Les boutons doivent agir comme annoncé; aucune plateforme ne sera décrite comme en direct avant qu’un état technique ne justifie cette formulation.

La bêta utilise des **clés de diffusion personnelles**, sans OAuth. Twitch reçoit la clé personnelle de l’utilisateur; YouTube reçoit l’adresse d’ingestion et la clé fournies dans YouTube Studio. Electron protège les paramètres par `safeStorage` du système et refuse leur sauvegarde si le chiffrement local est indisponible. Le renderer ne peut lire que des états « configuré / non configuré »; les clés ne vont ni dans `localStorage`, ni dans un serveur Camton Live, ni dans les journaux. Aucun mot de passe ou cookie de plateforme n’est demandé. Camton Live n’enregistre pas les événements YouTube : l’utilisateur doit avoir préparé son événement et peut devoir le démarrer dans Studio.

TikTok LIVE n’est pas pris en charge en 0.4. Cette version cible Windows x64, les sources média accessibles à Electron, les clés valides et les comptes autorisés; elle ne garantit pas la compatibilité de tout matériel, pilote, compte ou réseau. L’application reste un ZIP portable non signé, sans installateur `Setup.exe`; Windows peut afficher SmartScreen.

## Parcours produit

1. Renommer l’interface, la fenêtre, l’identifiant Electron, le symbole de marque, l’aide et le ZIP sous **Camton Live 0.4.0**.
2. Fournir une configuration distincte pour Twitch et YouTube, avec explications en français, validation locale des champs, sauvegarde chiffrée, états configuré/non configuré et suppression. TikTok reste explicitement désactivé.
3. Garder la capture d’écran/fenêtre intégrée et les caméras/cartes de capture USB. Construire la piste de diffusion en ajoutant la vidéo à une sortie `MediaStreamDestination` et en mixant le son de la source (quand il existe) avec le micro choisi; l’aperçu ou la démo seuls n’envoient rien.
4. Transporter les segments WebM produits par `MediaRecorder` vers Electron par IPC avec rétropression, puis vers un processus FFmpeg. FFmpeg décode la vidéo WebM et réencode en H.264/AAC avant la sortie RTMPS/RTMP. Utiliser un processus séparé par destination afin de conserver un état d’erreur indépendant; le multistream encode donc plusieurs fois et additionne les débits montant.
5. Embarquer une build Windows x64 FFmpeg **LGPL partagée** épinglée et vérifiée par SHA-256, avec ses DLL, ses avis et un lien vers le code source correspondant. Utiliser `h264_mf` (Media Foundation de Windows) plutôt que `libx264`; utiliser l’encodeur AAC intégré. La configuration embarquée comprend `--disable-libx264`; Camton Live vérifie `ffmpeg -encoders` au démarrage et refuse l’envoi si `h264_mf` ou AAC manque. La build reste à essayer sous Windows x64; l’aperçu statique ne remplace pas ce test.
6. Relier Fluide, Équilibré et Très net à des paramètres effectifs de résolution, cadence et débit. Refuser un démarrage sans source vidéo, microphone, destination sélectionnée et identifiants locaux configurés. Montrer les états réels par sortie, les erreurs de connexion/encodage et les débits estimés; arrêter tous les processus et pistes proprement. Le statut indique un encodage local et une tentative d’envoi vers l’ingestion; il ne confirme ni la réception par la plateforme, ni la création ou le démarrage de l’événement YouTube.
7. Garder une démo uniquement locale, ne jamais confondre démo et sortie réseau, et rendre l’aide, la confidentialité, les appareils, la configuration et les commandes de démarrage/arrêt fonctionnels ou clairement indisponibles.

## Structure technique

- `src/main.js` : état de préparation, sélection des destinations, capture/micro, mixage audio, `MediaRecorder`, préréglages, commande et affichage des états.
- `src/platforms.js` : profils de qualité et libellés des destinations; TikTok indisponible.
- `electron/main.cjs` : fenêtre, permissions contrôlées et IPC.
- `electron/secret-store.cjs` : chiffrement/déchiffrement local via `safeStorage` et fichier dans le dossier privé de l’application; aucune valeur secrète retournée au renderer.
- `electron/stream-engine.cjs` : recherche de l’encodeur empaqueté, processus FFmpeg isolés par sortie, transmission de données avec rétropression, traduction des erreurs en états expurgés.
- `electron/preload.cjs` : API contextBridge minimale, sans accès Node dans le renderer.
- `index.html`, `src/styles/` (jetons, base, mise en page, composants), `public/`, `build/` : interface, marque et icône Camton Live.
- `scripts/fetch-ffmpeg.mjs`, `licenses/`, `package.json` et le lockfile : téléchargement déterministe avec checksum, avis/licences et ZIP Windows x64.

Aucun backend n’est requis : la page publiée/Preview sert d’aperçu non opérationnel; la configuration sécurisée et le moteur de diffusion ne fonctionnent que dans l’application Electron. Les fichiers du stream restent locaux avant d’être envoyés directement aux points d’ingestion choisis.

## Direction visuelle

Réutiliser le studio sombre, lisible et compact, avec accents citron vert/turquoise, DM Sans et Space Grotesk. L’essence de marque est un studio de live clair pour les créateurs qui veulent passer du jeu au direct sans maîtriser un outil complexe; personnalité accessible, fiable et vive. Remplacer l’ancien S par un symbole géométrique de lumière et de signal vidéo, lisible en petite taille.

## Contraintes externes

- Twitch reçoit la vidéo via RTMP(S) et une clé de stream; la clé est un secret. Source : [Twitch Video Broadcast](https://dev.twitch.tv/docs/video-broadcast/).
- YouTube fournit ses réglages d’ingestion dans Studio; l’accès Live doit être activé et l’événement préexistant peut nécessiter une action manuelle. Sources : [YouTube Live avec un encodeur](https://support.google.com/youtube/answer/2907883?hl=fr) et [conditions d’accès au direct](https://support.google.com/youtube/answer/2474026?hl=fr).
- Le multistream additionne les débits sortants et double aussi le travail d’encodage dans cette architecture; l’application doit l’indiquer avant lancement. Source : [YouTube — diffusion sur plusieurs plateformes](https://support.google.com/youtube/answer/16404722?hl=en-IE).
- Le simulcast Twitch reste soumis à ses règles, notamment l’expérience équivalente et l’absence d’incitation active à migrer les viewers. Source : [Twitch — règles de simulcast](https://help.twitch.tv/s/article/simulcasting-guidelines?language=fr).
- FFmpeg est LGPL par défaut, mais les composants GPL (comme `libx264`) rendent la distribution correspondante GPL. Pour éviter de changer la licence de l’application sans décision, retenir le build partagé LGPL et l’encodeur Media Foundation de Windows, puis fournir les avis et sources liés au build exact. Sources : [FFmpeg licensing](https://www.ffmpeg.org/legal.html), [Media Foundation dans FFmpeg](https://ffmpeg.org/ffmpeg-codecs.html), [releases BtbN](https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases).

**Décisions déjà approuvées :** nom Camton Live; version 0.4.0; Twitch/YouTube avec clés personnelles chiffrées localement, sans OAuth; TikTok non pris en charge; ZIP portable Windows x64. Le profil utilisateur antérieur `LumaCast` est conservé afin de préserver l’accès aux clés chiffrées et préférences déjà enregistrées. Le passage d’ingestion à un événement visible sur la plateforme dépend toujours des réglages et actions du compte.
