P'TIT BAC — ÉCONOMIE OFFICIELLE

Ce document décrit les valeurs utilisées par le code serveur.

VIES
- Maximum : 5 vies.
- Recharge : +1 vie toutes les 30 minutes.
- Partie rapide : -1 vie au lancement réel.
- Salon public : -1 vie au lancement réel.
- Salon privé : aucune vie consommée.
- Si le lancement est annulé avant la partie, le serveur peut rembourser la vie.

PIÈCES
- Solde de départ : 25 pièces.
- Relance de lettre : 20 pièces.
- Relance de catégories : 20 pièces.
- Pub récompensée : +10 pièces.

RÉCOMPENSES DE FIN DE PARTIE
- 1er : 60 pièces.
- 2e : 40 pièces.
- 3e : 25 pièces.
- autres joueurs classés : 10 pièces.

Les récompenses ne sont attribuées que si :
- le mode utilise l'économie (public ou quick) ;
- la partie est réellement terminée ;
- au moins 2 joueurs humains participent ;
- aucun bot n'est présent ;
- le joueur a bien participé au lancement économique.

BOUTIQUE PRÉVUE
- 0,99 € : 25 pièces.
- 2,99 € : 100 pièces.
- Sans pub à vie : suppression des publicités automatiques + bonus de 100 pièces.

Les achats intégrés et la vraie publicité mobile ne sont pas encore branchés.
Le mode REWARDED_AD_DEV_MODE sert uniquement aux tests et applique lui aussi
la récompense officielle de +10 pièces.

SOURCE DE VÉRITÉ
Les valeurs sont centralisées dans economy-config.js.
Le portefeuille PostgreSQL ptitbac_wallets est l'unique source de vérité pour
les pièces et les gemmes.
