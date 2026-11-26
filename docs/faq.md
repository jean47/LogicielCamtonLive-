# FAQ Camton Live

Version publiée le 2 décembre 2026, avec la destination TikTok et le relais.

## Camton Live diffuse-t-il vraiment en direct ?

Oui. L'application encode sur ton PC et envoie le flux à la plateforme que tu as configurée. Elle ne peut pas garantir la réception : c'est la plateforme qui accepte ou refuse le flux. Vérifie l'état du direct dans Twitch ou dans YouTube Studio.

## Où trouver ma clé Twitch ?

Tableau de bord créateur → **Paramètres** → **Diffusion** → **Clé de flux primaire**, puis « Afficher » et copie. Le détail est dans [le guide des destinations](guide-destinations.md#twitch).

## Où trouver l'adresse et la clé YouTube ?

YouTube Studio → **Créer** → **Passer au direct** → **Gérer** → **Programmer un direct**, puis **Diffusion personnalisée** dans les paramètres du flux. L'adresse commence par `rtmps://` et la clé fait une trentaine de caractères.

## Et TikTok ?

La destination est disponible **depuis le 2 décembre 2026**. Il faut l'adresse du serveur et la clé de flux fournies par l'application TikTok. Deux différences avec Twitch : la clé change à chaque direct, et l'accès au direct dépend du compte et du pays.

Camton Live n'utilise aucune API non officielle.

## TikTok ne me donne pas de clé, un relais aide-t-il ?

Oui pour le cas de la clé. La carte **Relais** accepte l'adresse et la clé d'un service de multidiffusion (Restream, Streamlabs) ou d'un serveur RTMP personnel : le relais fournit sa propre clé et pousse ensuite vers TikTok.

Non pour l'éligibilité. Si TikTok refuse le direct à ton compte, le relais échouera aussi : l'autorisation vient de la plateforme, pas de l'intermédiaire.

Un relais a un autre avantage : un seul flux sort de ton PC, même si tu diffuses sur trois plateformes.

## Comment savoir si mon direct part vraiment ?

Chaque carte de destination affiche, pendant le direct, le débit réellement encodé, les images par seconde et les images perdues. C'est une mesure locale : elle prouve que l'encodeur produit un flux stable, pas que la plateforme l'accepte. La réception se vérifie dans l'outil de la plateforme.

## Puis-je diffuser sur quatre plateformes ?

Oui, jusqu'à quatre. Chacune consomme son propre débit montant : trois destinations en « Équilibré », c'est environ 13,5 Mb/s. Au-delà de deux, un relais (Restream, Streamlabs) reste plus économe : un seul envoi, il répartit.

## Comment signaler un bug ?

Le lien **Signaler un problème** de la barre latérale écrit un rapport sur ton Bureau et ouvre une issue GitHub préremplie. Le rapport contient la version, ton système, l'encodeur et les dernières lignes de FFmpeg ; les clés y sont masquées. Rien ne part sans ton clic, et l'application n'envoie aucune donnée à un serveur Camton Live.

## Mes clés partent-elles sur un serveur ?

Non. Elles sont chiffrées sur ton PC avec le stockage sécurisé de Windows (`safeStorage`) et ne sont jamais réaffichées dans l'application. Pendant un direct, l'adresse complète est passée à FFmpeg : elle peut donc apparaître dans un outil local d'inspection des processus. Aucune clé n'est envoyée à un serveur Camton Live, il n'y en a pas.

## Puis-je diffuser sur plusieurs plateformes en même temps ?

Oui. Camton Live lance un encodage par destination. Deux plateformes, c'est deux fois le débit montant : vérifie ta connexion avant de cocher la deuxième.

## Quel réglage de qualité choisir ?

| Réglage | Image | Débit par destination | Pour qui |
| --- | --- | --- | --- |
| Fluide | 720p · 30 i/s | ~3 Mb/s | Connexion modeste |
| Équilibré | 720p · 60 i/s | ~4,5 Mb/s | Par défaut |
| Très net | 1080p · 60 i/s | ~6 Mb/s | PC solide, bonne fibre |

## Pourquoi Windows affiche-t-il un avertissement au téléchargement ?

L'installateur n'est pas encore signé. Clique sur **Informations complémentaires**, puis **Exécuter quand même**. Les empreintes SHA-256 sont publiées avec chaque version pour vérifier le fichier.

## Pourquoi l'application indique « Bêta » ?

Camton Live reste en bêta jusqu'à la version 1.0.0. Tes réglages sont conservés d'une version à l'autre, mais les destinations peuvent encore évoluer.

## Comment revenir à une version précédente ?

Les installateurs sont sur la page des versions GitHub. Une version plus ancienne s'installe par-dessus ; les clés enregistrées restent en place.

## L'application peut-elle créer ou démarrer mon événement YouTube ?

Non. Camton Live ne se connecte pas à ton compte Google : tu crées l'événement dans YouTube Studio, puis tu colles l'adresse et la clé.

## Où sont les rapports d'erreur ?

Sur le Bureau, dans un fichier texte créé au moment de l'échec : encodeur utilisé, code de sortie et dernières lignes FFmpeg. Aucune clé n'y est écrite en clair.
