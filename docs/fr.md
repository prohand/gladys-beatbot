# Beatbot

Cette intégration relie Gladys à vos **robots piscine Beatbot** (gammes
AquaSense, Sora…) et à leur **station de nettoyage**, à travers le cloud
Beatbot.

## Ce qu'il faut savoir avant de commencer

- **Gladys 5.3 ou plus récent**.
- Vos robots doivent déjà fonctionner dans l'**application Beatbot** (compte
  créé, robot appairé, Wi-Fi configuré).
- Les robots Beatbot ne se pilotent **que par le cloud Beatbot** : Gladys a
  besoin d'un accès Internet. Il n'y a pas de pilotage local.
- Un robot qui plonge perd souvent le Wi-Fi : il apparaît alors **injoignable**
  quelques minutes, c'est normal.

## Connexion du compte

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Cliquez sur **Connecter** à côté de **Compte Beatbot**.
3. La page de connexion Beatbot s'ouvre : identifiez-vous et autorisez l'accès.
   Votre mot de passe est saisi chez Beatbot, il ne passe jamais par Gladys.
4. De retour dans Gladys, l'état de connexion passe au vert et vos robots
   apparaissent dans l'onglet **Découverte**, prêts à être ajoutés.

Le bouton **Tester la connexion** liste les robots trouvés, leur état et leur
batterie.

### Les autres réglages

| Réglage                      | À quoi il sert                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Région**                   | Où votre compte est hébergé (Europe, Amérique du Nord, Chine). **Automatique** la lit dans le compte : ne la changez que si on vous le demande. |
| **Rafraîchissement complet** | Les états arrivent en temps réel. Cette lecture complète (10 min par défaut) rattrape ce qu'une coupure réseau aurait fait manquer.             |
| **Identifiant client OAuth** | Réglage avancé. Laissez la valeur par défaut, sauf si Beatbot vous a fourni un autre identifiant.                                               |

### Si le bouton Connecter ne fait rien

Gladys ouvre la page de connexion Beatbot dans un nouvel onglet. Si aucun
onglet ne s'ouvre, le navigateur l'a sans doute bloqué comme fenêtre pop-up
(Safari sur iPhone et iPad le fait souvent) : autorisez les pop-ups pour
l'adresse de votre Gladys (sur iPhone : **Réglages → Apps → Safari → Bloquer
les pop-ups**, désactivé), ou passez par un ordinateur, puis cliquez à nouveau
sur **Connecter**.

La valeur `home-assistant` de **Identifiant client OAuth** est seulement le nom
du client public que Beatbot publie pour la domotique : Home Assistant n'est
pas nécessaire.

### Si la page Beatbot refuse la connexion

L'intégration utilise l'accès « open API » que Beatbot publie pour la
domotique, avec l'identifiant client public fourni par Beatbot.

**Problème connu : « Whitelabel Error Page … status=400 ».** Après la saisie de
votre e-mail et de votre mot de passe, la page Beatbot peut afficher :

```
Whitelabel Error Page
There was an unexpected error (type=Bad Request, status=400).
```

- Ce n'est pas votre mot de passe : la page Beatbot ne vérifie l'adresse de
  retour de Gladys qu'après la connexion, et ne l'accepte pas encore pour
  l'identifiant client public.
- Une demande est ouverte chez Beatbot pour accepter Gladys : suivez-la sur
  [GitHub](https://github.com/Beatbot-Robotics/beatbot-cloud-python/issues/6). Rien ne peut être corrigé côté Gladys d'ici là.
- Vous êtes maintenant connecté chez Beatbot : chaque nouvel essai tombe
  directement sur cette erreur. Pour revoir la page de connexion, utilisez une
  fenêtre de navigation privée (ou supprimez les cookies de
  `oauth.beatbot.com`).
- Si Beatbot vous donne un identifiant client pour Gladys, saisissez-le dans
  **Identifiant client OAuth**, enregistrez, puis cliquez à nouveau sur
  **Connecter**.

## Ce que vous obtenez

Pour chaque robot (et chaque station), selon ce que le robot propose :

| Fonctionnalité               | Détail                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| **État**                     | Arrêté, nettoyage, pause, erreur, retour, en charge, à la base.                                |
| **Nettoyage**                | Marche / pause du nettoyage.                                                                   |
| **Retour à la base**         | Fait revenir le robot (à sa base ou à la ligne d'eau pour être récupéré).                      |
| **Batterie** / **En charge** | Niveau de batterie en % et charge en cours (robots seulement, pas la station).                 |
| **Mode de nettoyage**        | Liste des modes du robot (fond, parois, ligne d'eau…), tels que Beatbot les nomme.             |
| **Sécurité enfant**          | Verrouillage des boutons du robot.                                                             |
| **Ne pas déranger**          | Coupe les messages vocaux du robot (en lecture seule si le robot ne permet pas de le changer). |

Chaque robot porte un badge **cloud** quand il est joignable, **injoignable**
sinon.

## Scènes

L'intégration ajoute ses cartes à l'éditeur de scènes (Gladys 5.1 ou plus
récent), dans la catégorie **Intégrations**.

Déclencheurs :

- **État du robot piscine modifié** — filtrez éventuellement sur le robot et
  sur le nouvel état. Les actions suivantes lisent
  `{{triggerEvent.data.status}}`, `{{triggerEvent.data.previous_status}}` et
  `{{triggerEvent.data.detail}}` (état détaillé : plongée, remontée…).
- **Nettoyage de la piscine terminé** — un cycle s'est terminé normalement.
  Variables : `{{triggerEvent.data.duration_minutes}}` (vide si le cycle avait
  commencé avant le démarrage de l'intégration) et
  `{{triggerEvent.data.battery}}`.
- **Défaut du robot piscine** — un défaut vient d'apparaître (robot coincé,
  panier plein, défaut moteur…). Filtrez sur les défauts qui vous intéressent.
  Variables : `{{triggerEvent.data.error}}`, `{{triggerEvent.data.label_fr}}`.

Actions (chacune indique `sent` : faux si le robot ne propose pas cet ordre) :

- **Démarrer le nettoyage de la piscine**
- **Mettre en pause le nettoyage**
- **Faire revenir le robot piscine**
- **Choisir le mode de nettoyage** — saisissez le nom du mode tel qu'il
  apparaît sur l'appareil dans Gladys.

Exemple : « Quand le nettoyage est terminé, m'envoyer un message avec la
durée », ou « Quand le robot est coincé, m'alerter ».

## Tableau de bord

Ajoutez le widget **Robot piscine** et choisissez le robot : il affiche la
batterie en direct, l'état, le défaut en cours, la liaison, le mode et la durée
du dernier nettoyage, avec les boutons **Démarrer**, **Pause** et **Retour**.

Quand le robot permet de changer son mode de nettoyage, un bouton **Mode de
nettoyage** ouvre un petit formulaire listant les modes de ce robot, pré-rempli
avec le mode en cours : choisissez-en un et envoyez-le (une
fonction de Gladys 5.2, couverte par le Gladys 5.3 requis par l'intégration).

## Dépannage

- **« Cliquez sur Connecter… »** : aucun compte lié, ou l'autorisation a expiré
  ou a été révoquée : cliquez à nouveau sur **Connecter**.
- **« Votre compte Beatbot n'a pas indiqué sa région »** : choisissez la région
  dans **Région** et enregistrez.
- **« Cloud Beatbot injoignable »** : vérifiez l'accès Internet de Gladys ;
  l'intégration réessaie toute seule.
- **Les états ne bougent plus en temps réel** : un autre logiciel (par exemple
  Home Assistant) utilise peut-être le même compte Beatbot et a pris la
  connexion temps réel. Les états restent mis à jour à chaque rafraîchissement
  complet.
- Les logs de l'intégration sont visibles depuis Gladys. Ils ne contiennent
  jamais vos jetons.
