# Guide des destinations : Twitch, YouTube et TikTok

Ce guide explique où trouver chaque information demandée par Camton Live. Les menus des plateformes changent parfois ; si un intitulé diffère, cherche l'équivalent le plus proche.

## Avant de commencer

- Installe Camton Live sur Windows et ouvre l'application : l'aperçu Web ne peut pas enregistrer de clé.
- Prépare ta source (écran, fenêtre ou carte de capture) et vérifie que le vu-mètre du micro bouge.
- Ne colle jamais un mot de passe dans Camton Live. Seules les clés de diffusion et les adresses de serveur sont demandées.

## Twitch

### Où trouver la clé

1. Connecte-toi sur Twitch et ouvre le **tableau de bord créateur**.
2. Va dans **Paramètres**, puis **Diffusion**.
3. La **clé de flux primaire** s'affiche masquée : clique sur **Afficher**, puis copie-la.
4. Colle-la dans Camton Live, carte **Twitch**, champ « Clé de diffusion Twitch ».

### Ce qu'il faut savoir

- La clé Twitch est permanente. Elle ne change que si tu cliques sur « Réinitialiser ».
- Si tu réinitialises la clé, l'ancienne cesse de fonctionner immédiatement : mets à jour Camton Live.
- Le serveur est fixe, Camton Live l'applique tout seul : `rtmps://live.twitch.tv:443/app`.
- Le titre et la catégorie du direct se règlent sur Twitch, pas dans Camton Live.

## YouTube

### Où trouver l'adresse du serveur et la clé

1. Ouvre **YouTube Studio** avec le compte de la chaîne.
2. Clique sur **Créer**, puis **Passer au direct**.
3. Dans l'onglet **Gérer**, clique sur **Programmer un direct** et remplis les informations demandées.
4. Dans **Paramètres du flux**, choisis **Diffusion personnalisée** : c'est ce mode qui fournit une adresse de serveur et une clé. Le mode « intégré » ne les affiche pas.
5. Copie l'**adresse du serveur** (elle commence par `rtmps://`) et la **clé de diffusion**.
6. Colle les deux dans Camton Live, carte **YouTube**.

### Ce qu'il faut savoir

- YouTube exige souvent un événement créé et parfois démarré dans Studio avant d'accepter le flux.
- Camton Live ne crée pas l'événement et ne peut pas toujours le démarrer à ta place : c'est une limite volontaire, l'application n'accède pas à ton compte Google.
- L'adresse YouTube peut prendre plusieurs formes (`rtmp://a.rtmp.youtube.com/live2`, `rtmps://a.rtmps.youtube.com:443/live2`). Camton Live les ramène toutes vers la version sécurisée sur le port 443, mieux acceptée par les box et les réseaux d'entreprise.
- Une clé YouTube peut être réutilisée d'un direct à l'autre tant que l'événement existe.

## TikTok

La destination TikTok est disponible dans Camton Live **à partir du 2 décembre 2026**. La marche à suivre détaillée sera publiée à cette date.

### Ce qui est déjà vrai

- TikTok ne fournit une adresse de serveur et une clé de flux qu'aux comptes qui ont accès au direct **et** à la diffusion par clé. L'accès dépend du compte, du pays et des conditions en vigueur.
- La clé TikTok est liée à un direct : elle est régénérée pour chaque session et ne se réutilise pas comme une clé Twitch.
- Le flux part en RTMPS sur le port 443, comme pour YouTube.
- Camton Live n'utilise pas d'API non officielle et ne récupère pas les clés à ta place.

### Si tu n'as pas l'option « clé de flux »

Deux solutions existent, aucune n'est fournie par Camton Live :

1. **Le relais** : tu pousses ton flux vers un service de multidiffusion (Restream, Streamlabs) qui se charge de TikTok. La clé du relais est stable, mais il faut un compte et parfois un abonnement.
2. **L'application TikTok** : certains comptes diffusent uniquement depuis l'application mobile ou l'outil de bureau TikTok. Dans ce cas, Camton Live ne peut pas s'y substituer.

## Vérifier que ça part

- Le statut « Encodage actif » signifie que l'encodeur tourne sur ton PC. Il ne garantit pas la réception.
- Vérifie la réception côté plateforme : tableau de bord Twitch, état du direct dans YouTube Studio, ou aperçu du direct dans l'application TikTok.
- En cas d'échec, Camton Live écrit un rapport sur le Bureau : encodeur utilisé, code de sortie et dernières lignes FFmpeg.
- Message « clé refusée » : la clé est fausse, réinitialisée ou l'événement n'est pas prêt. Message « connexion impossible » : réseau, pare-feu ou adresse de serveur.

## Débit et qualité

Chaque destination sélectionnée a son propre encodage et consomme son propre débit montant.

| Réglage | Image | Débit par destination |
| --- | --- | --- |
| Fluide | 720p · 30 i/s | ~3 Mb/s |
| Équilibré | 720p · 60 i/s | ~4,5 Mb/s |
| Très net | 1080p · 60 i/s | ~6 Mb/s |

Deux plateformes en « Équilibré », c'est environ 9 Mb/s montants, plus la marge réseau. Teste ta connexion avant de cocher une deuxième destination.
