P'TIT BAC — ECONOMIE ACTUELLE

Ce document décrit le comportement réellement présent dans le code de la
version 1.45.0.

VIES
- Maximum : 5 vies.
- Recharge : +1 vie toutes les 30 minutes.
- Partie rapide : -1 vie au lancement réel.
- Salon public : -1 vie au lancement réel.
- Salon privé : aucune vie consommée.
- Si un lancement économique est annulé avant la partie, le serveur possède
  un mécanisme de remboursement.

PIECES
- Source de vérité : table PostgreSQL ptitbac_wallets.
- public.users ne contient plus de copie du solde depuis E8.
- Solde de départ actuel : 50 pièces.
- Relance de lettre : 20 pièces.
- Relance de catégories : 20 pièces.

RECOMPENSES DE FIN DE PARTIE
- 1er : 60 pièces.
- 2e : 40 pièces.
- 3e : 25 pièces.
- autres joueurs classés : 10 pièces.

Les récompenses ne sont attribuées que si :
- le mode utilise l'économie (public ou quick) ;
- la partie est réellement terminée ;
- au moins 2 joueurs humains participent ;
- aucun bot n'est présent ;
- le joueur a bien participé à l'entrée économique.

PUB RECOMPENSEE
Le mode de développement actuel réserve encore une récompense de 80 pièces
avec REWARDED_AD_DEV_MODE=true.

La vraie publicité mobile n'est pas encore branchée.

IMPORTANT
Le code serveur reste la source de vérité. Les anciennes règles +/-20 %, le
fichier economy-hook.js et les anciennes instructions Supabase ne sont plus
d'actualité.
