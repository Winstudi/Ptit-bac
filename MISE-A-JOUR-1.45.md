# P'tit Bac — état de la version 1.45

Ce fichier est conservé comme repère de version. Les anciennes instructions
de patch contenues ici ont été remplacées par l'architecture actuelle.

## État fonctionnel

### Modes

**Quick**
- 1 manche
- 6 catégories
- 60 secondes
- difficulté medium
- économie et XP actifs

**Public**
- rejoignable par la recherche rapide lorsqu'il est disponible
- économie et XP actifs
- bots interdits

**Privé**
- aucun gain de pièces
- aucun gain d'XP
- aucune vie consommée
- bots de test autorisés

## Inventaire

- 5 avatars de base : `/a1.webp` à `/a5.webp`
- système de cadres conservé
- tag débutant
- PostgreSQL comme source de vérité lorsque la base est disponible

## Progression

- 50 niveaux
- XP uniquement sur les parties éligibles
- compteur de réponses valides distinct du score
- distribution idempotente en fin de partie

## Backend

- Pool PostgreSQL unique via `db.js`
- migrations centralisées via `db-migrations.js`
- `ptitbac_wallets` est l'unique source de vérité des pièces
- présence amis/chat partagée via `presence-service.js`
- sécurité Socket.IO centralisée
- quick-match séparé
- inventaire et progression dans des services dédiés

## Frontend

Les anciens renderers principaux ont été nettoyés de `app.js`.
Les écrans modernes restent dans des modules séparés.

Le frontend utilise un bus de rendu commun plutôt que plusieurs observers
globaux.

## Build

Les anciennes étapes E2 à E5 ne sont plus exécutées au build.

Render lance maintenant :

```text
npm ci
npm test
npm run check
cleanup-frontend-build.cjs
npm run check:production
optimisation WebP
npm start
```

## À ne plus utiliser

Les anciennes instructions faisant référence à :

- `apply-core-cleanup.cjs`
- `economy-hook.js`
- `ai-runtime-fix.js`
- un build Render limité à `npm ci`
- 5 manches en partie rapide

sont obsolètes.
