# Camton Live — bêta 0.4

## Marque et version
- [x] L’application porte le nom **Camton Live** dans l’interface, le titre de fenêtre, les ressources visuelles, l’identifiant Electron, l’aide et les fichiers livrés; la version du paquet est `0.4.4`.
- [x] Le paquet final est une application portable Windows x64 dans une archive ZIP; l’utilisateur peut extraire puis lancer `Camton Live.exe`. Le paquet n’est pas présenté comme un `Setup.exe`.

## Sources et audio
- [x] Le parcours guidé en français permet de choisir d’abord une source PC parmi les écrans, fenêtres ou jeux exposés au sélecteur de partage.
- [x] L’utilisateur peut préparer une source Xbox via une carte de capture HDMI reliée en USB au PC, avec les consignes de branchement.
- [x] L’application peut prévisualiser localement une source et tester le micro avant diffusion.
- [x] La table de mixage gère plusieurs pistes actives (micro principal, second micro, son de la source, musique) avec volume, muet, solo et vu-mètre par piste.
- [x] Un master général règle le volume de tout le direct et peut le couper d’un seul bouton.
- [x] Les réglages de mixage sont mémorisés d’une session à l’autre.
- [x] Au lancement réel, le son de la source (lorsqu’il est disponible) et le microphone sélectionné sont mélangés dans le flux envoyé; arrêter l’aperçu ou le direct libère les pistes média.

## Destinations Twitch et YouTube — configuration par clés
- [x] L’utilisateur peut configurer Twitch avec sa clé de diffusion personnelle et configurer YouTube avec l’adresse d’ingestion et sa clé de diffusion.
- [x] L’interface signale clairement quelles destinations sont configurées, permet de modifier ou effacer leurs clés et ne demande jamais un mot de passe de plateforme.
- [x] Les clés sont chiffrées par le stockage sécurisé du système via Electron; elles ne sont pas conservées dans `localStorage`, un serveur Camton Live ou les journaux, et le renderer ne peut pas les relire.
- [x] La bêta 0.4 n’utilise pas OAuth et ne crée pas automatiquement un événement YouTube; l’utilisateur conserve ses clés et paramètres officiels depuis chaque plateforme et doit préparer/démarrer l’événement si la plateforme l’exige.
- [x] TikTok LIVE reste indisponible en 0.4; l’interface explique cette limite et ne prétend pas connecter ou diffuser vers TikTok.

## Encodage et contrôle du direct
- [x] Le moteur de bureau encode les sources prises en charge en H.264/AAC et envoie réellement le flux vers la ou les destinations sélectionnées via leur sortie RTMP/RTMPS.
- [x] Le ZIP contient l’encodeur Windows x64 requis, les DLL et les avis/licences/source du build LGPL retenu; il n’embarque pas par défaut un build GPL contenant `libx264`.
- [x] Les réglages Fluide, Équilibré et Très net modifient les paramètres effectifs de résolution, cadence et débit de l’encodeur.
- [x] L’application refuse de démarrer tant que la source vidéo, le microphone ou une destination valide manquent; elle affiche les erreurs utiles au lieu d’afficher un statut de direct simulé.
- [x] « Démarrer un direct » lance les sorties configurées et montre l’état réel par destination; « Arrêter le direct » ferme les sorties et libère l’encodeur.
- [x] Si Twitch et YouTube sont sélectionnés simultanément, l’application avertit du débit montant total estimé et montre l’état indépendant des deux sorties.
- [x] Le statut distingue le flux encodé ou la tentative d’envoi à l’ingestion d’un événement officiellement démarré sur YouTube; l’application ne prétend pas confirmer la réception ou la diffusion par la plateforme.
- [x] La démo reste strictement locale et ne modifie jamais les badges pour faire croire à une diffusion réelle.

## Mises à jour
- [x] Un pop-up « Quoi de neuf » résume les changements au premier lancement d’une nouvelle version (`src/release-notes.json`).
- [x] Quand une mise à jour est publiée dans le manifeste en ligne, le bandeau propose un bouton « Nouveautés » qui affiche les `releaseNotes` publiées.

## Contrôles, sécurité et état de disponibilité
- [x] Le sélecteur de sources PC est intégré à la fenêtre Electron et l’API de capture reste isolée via preload.
- [x] Les actions de configuration des plateformes, scan des périphériques, capture, test audio, préréglages, aide, confidentialité, démo, démarrage et arrêt exécutent leur action annoncée ou sont désactivées avec une explication claire.
- [x] Aucun indicateur « connecté », « en direct » ou « prêt » n’apparaît sans état confirmé; l’utilisateur peut supprimer ses clés locales.

## Livraison et validation
- [x] Les builds Vite et Electron passent et le ZIP portable contient `Camton Live.exe`, les ressources de l’application et l’encodeur Windows x64 requis.
- [ ] Le chemin complet est essayé sur Windows x64 avec une clé Twitch et/ou YouTube valide; tout résultat non testé sur le matériel ou le compte de l’utilisateur reste présenté comme limite, pas comme garantie « 100 % ». _(Reste à faire hors de cet environnement : l’automatisation tourne sous Linux, sans compte Twitch/YouTube. Le moteur est couvert par des tests qui exécutent un faux FFmpeg réel, mais l’envoi RTMP réel doit être validé sur une machine Windows.)_
- [x] Les consignes précisent la disponibilité selon les autorisations des comptes, le débit montant, la compatibilité des cartes de capture, l’absence d’installateur classique et l’avertissement SmartScreen possible.
