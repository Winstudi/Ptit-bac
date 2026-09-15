# Optimisation et architecture — état actuel

## Sources intégrées

Depuis E6.2, les principales corrections sont directement présentes dans les
fichiers GitHub.

Le build ne doit plus transformer la logique applicative.

### Intégré directement

- Pool PostgreSQL partagé (`db.js`) ;
- compteur de réponses valides pour l'XP ;
- compte à rebours autoritaire côté serveur ;
- sécurité Socket.IO ;
- bus de rendu frontend ;
- suppression des observers individuels historiques ;
- nettoyage des anciens renderers de `app.js` ;
- nettoyage d'une grande partie du CSS legacy ;
- audio de roue extrait dans `letter-wheel-spin.wav`.

## Taille des principaux fichiers après nettoyage

Au moment de E6.2 :

- `app.js` : environ 23 Ko ;
- `style.css` : environ 107 Ko ;
- `letter-wheel-v1.js` : environ 26 Ko.

Ces valeurs sont des repères et peuvent évoluer avec les futures fonctions.

## Bundles frontend

`cleanup-frontend-build.cjs` reste actif uniquement pour regrouper plusieurs
petits fichiers en bundles de production.

Il génère notamment :

- `ptb-category-avatar-patches.css`
- `ptb-ui-wheel-patches.css`
- `ptb-late-patches.css`
- `ptb-core-client.js`
- `ptb-ui-patches.js`
- `ptb-late-client.js`

Ces fichiers sont générés au build et ne doivent pas devenir la source de
vérité.

## Images

`optimize-assets.cjs` crée des versions WebP de plusieurs PNG dans
`.ptb-assets/`.

Le serveur choisit automatiquement le WebP lorsque le navigateur le supporte
et conserve le PNG en fallback.

## Tests avant déploiement

Render exécute :

1. `npm ci`
2. `npm test`
3. `npm run check`
4. génération des bundles frontend
5. `npm run check:production`
6. optimisation images
7. démarrage

## Prochaines optimisations conseillées

- centraliser les migrations PostgreSQL ;
- supprimer définitivement les scripts historiques E1/E2/E3/E4/E5 ;
- unifier la présence amis/chat ;
- réduire progressivement le nombre de couches CSS d'un même écran ;
- déplacer le CSS injecté par `progression-client.js` dans un fichier CSS ;
- verrouiller `sharp` dans les dépendances plutôt que l'installer à chaque
  build ;
- remplacer progressivement les très gros PNG sources par des fichiers déjà
  optimisés.
