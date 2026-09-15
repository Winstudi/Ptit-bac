# P'tit Bac

Jeu multijoueur mobile-first de Petit Bac, développé en Node.js avec Express, Socket.IO et PostgreSQL.

## État actuel

Version applicative : **1.46.1**

Le dépôt contient désormais directement le code réellement exécuté en production. Les anciennes transformations E2, E3, E4 et E5 ne sont plus nécessaires au déploiement.

Les principaux systèmes actifs sont :

- salons privés, salons publics et partie rapide ;
- profils, avatars, cadres et tags ;
- amis, invitations, messagerie et signalements ;
- portefeuille pièces/gemmes et vies rechargeables ;
- progression XP sur 50 niveaux ;
- validation automatique des réponses ;
- bots de test ;
- administration serveur ;
- sécurité Socket.IO avec rate limiting ;
- tests automatiques avant déploiement.

## Modes de jeu

### Partie rapide

Format fixe :

- 1 manche ;
- 6 catégories ;
- 60 secondes ;
- difficulté `medium` ;
- recherche automatique de joueurs ;
- économie et XP activées.

### Salon public

Salon créé par un joueur, visible par la recherche rapide lorsqu'il est rejoignable.

- économie activée ;
- XP activée ;
- 1 vie consommée au lancement réel ;
- bots interdits.

### Salon privé

Salon sur invitation/code.

- aucune vie consommée ;
- aucun gain de pièces ;
- aucun gain d'XP ;
- bots de test autorisés.

## Architecture

### Backend

- `server.js` : serveur HTTP, Socket.IO et logique principale de partie ;
- `db.js` : Pool PostgreSQL partagé ;
- `db-migrations.js` : schéma PostgreSQL central ;
- `presence-service.js` : présence temps réel commune aux amis et au chat ;
- `socket-security.js` : sécurité et limites de fréquence ;
- `inventory-service.js` : inventaire serveur ;
- `progression-service.js` : XP et niveaux ;
- `quick-match.js` : recherche de partie rapide ;
- `economy-config.js` : valeurs officielles de l’économie et de la boutique ;
- `game-economy.js` : récompenses de fin de partie ;
- `friends-hook.js`, `chat-hook.js`, `admin-hook.js`, `player-report-hook.js` : modules serveur spécialisés.

### Frontend

`app.js` contient le noyau client. Les écrans modernes sont séparés dans leurs propres modules (`home-screen-v1.js`, `lobby-screen-v4.js`, `answer-screen-v1.js`, etc.).

Le rendu dynamique utilise un bus commun :

- `ptitbac:screen-rendered`
- `ptitbac:dom-updated`

Cela évite plusieurs `MutationObserver` concurrents.

## Base de données

Configurer `DATABASE_URL` sur Render.

Un seul Pool PostgreSQL est créé dans `db.js` puis partagé par les modules serveur.

Depuis E8, toutes les créations et évolutions de tables sont centralisées dans `db-migrations.js`. Les modules fonctionnels ne créent plus leurs propres tables.

`ptitbac_wallets` est la source de vérité pour les pièces et les gemmes. L'ancien champ `public.users.coins` est migré puis supprimé automatiquement.

La présence en ligne des amis et du chat est partagée via `presence-service.js`.

Le panneau admin et les récompenses de boîte de réception utilisent désormais le même inventaire officiel (`ptitbac_inventory_items`) que le joueur.

## OpenAI

Variables principales :

- `OPENAI_API_KEY`
- `OPENAI_VALIDATION_MODEL` (optionnel)
- `OPENAI_VALIDATION_REVIEW_MODEL` (optionnel)
- `OPENAI_BOT_API_KEY` (optionnel)
- `OPENAI_BOT_MODEL` (optionnel)
- `BOT_AI_ENABLED` (`true` / `false`)

Sans clé pour les bots, le jeu utilise son générateur local.

## Autres variables utiles

- `DATABASE_URL`
- `PTITBAC_ADMIN_CODE`
- `SOCKET_CORS_ORIGIN`
- `PTITBAC_DB_POOL_MAX`
- `REWARDED_AD_DEV_MODE`

Ne jamais stocker de clé privée directement dans GitHub.




## Progression de fin de partie — 1.46.1

Les pièces ne sont plus attribuées à la fin d'une partie.

Une partie Quick/Public éligible donne désormais :

- XP selon les manches, réponses valides et classement ;
- trophées selon le classement : 1er +10, 2e +6, 3e +3, autres +1.

Le salon privé et les parties avec bots ne donnent ni XP ni trophées.

La 1.46.1 renforce aussi la stabilité en partie :

- réponses restaurées après reconnexion ;
- chrono basé sur l'heure serveur ;
- validation IA limitée par un délai maximal avec fallback automatique ;
- distribution XP/trophées idempotente.

## Boucle de jeu 1.46

La boucle multijoueur a été renforcée :

- en Quick, aucun clic d'un hôte technique n'est requis sur l'écran des résultats ;
- un hôte déconnecté peut se reconnecter pendant 15 secondes avant qu'un autre humain connecté prenne le relais ;
- quitter pendant le choix des catégories ou de la lettre ne rembourse pas la vie consommée ;
- lors d'un duel interrompu en cours de partie, le joueur qui reste récupère sa vie tandis que l'abandonneur conserve le coût de son entrée ;
- quitter après la dernière manche valide d'abord la fin de partie afin de ne pas perdre les récompenses ;
- les principaux boutons de sortie attendent désormais la confirmation du serveur avant d'effacer la session locale.

## Santé du service

`GET /health` permet au site et à la future application mobile de vérifier le
backend. La réponse contient notamment :

- la version applicative ;
- le commit Render réellement déployé (`RENDER_GIT_COMMIT`) ;
- l'état PostgreSQL ;
- le type de stockage actif ;
- l'uptime du processus.

Sur Render, PostgreSQL est obligatoire. Si `DATABASE_URL` est absent ou si
l'initialisation PostgreSQL échoue, le serveur refuse désormais de démarrer au
lieu de basculer silencieusement sur un fichier JSON local.

Le fallback JSON reste disponible uniquement pour le développement local et
les tests.

## Tests

```bash
npm test
npm run check
```

`npm test` lance les fichiers `*.test.cjs`.

Les tests couvrent notamment :

- quick-match ;
- modes public/privé/rapide ;
- inventaire ;
- progression ;
- économie ;
- sécurité Socket.IO ;
- démarrage réel du serveur via `/health`.

## Déploiement Render

Le build actuel suit cette chaîne :

```text
npm ci
→ npm test
→ npm run check
→ cleanup-frontend-build.cjs
→ npm run check:production
→ optimisation WebP
→ npm start
```

`cleanup-frontend-build.cjs` ne réécrit plus la logique du jeu. Il regroupe seulement certains fichiers frontend en bundles de production.

## Assets

Les fichiers publics sont explicitement listés dans `public-files.json`.

Les gros PNG sont convertis en WebP pendant le build lorsque `sharp` est disponible. Les URL PNG restent compatibles grâce au serveur.

## Règle de maintenance

Le code présent dans GitHub doit rester la source de vérité.

Ne pas réintroduire de système qui modifie `server.js`, `app.js`, `style.css` ou les modules fonctionnels pendant le build.
