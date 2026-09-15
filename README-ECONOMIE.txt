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
- Aucune pièce n'est gagnée en fin de partie.
- Les parties Quick/Public éligibles donnent de l'XP et des trophées.
- Barème trophées actuel : 1er +10, 2e +6, 3e +3, autres +1.
- Salon privé : aucun XP et aucun trophée.
- Partie avec bot : aucun XP et aucun trophée.

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
