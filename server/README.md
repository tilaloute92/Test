# Serveur d'authentification — Suivi Infra & Réseau

Petit service Express qui vérifie les connexions (compte local, Active Directory/LDAP, ou finalisation du SSO Microsoft) et ouvre une session sécurisée (cookie signé, non lisible par le JavaScript de la page). C'est ce service, et lui seul, qui décide si quelqu'un est réellement connecté — le navigateur ne peut pas se l'auto-attribuer.

Ce service est **optionnel** : sans lui, l'application continue de fonctionner normalement en mode 100% statique, avec le SSO Microsoft (géré uniquement côté navigateur) comme unique option de connexion automatique. Il devient nécessaire dès que vous voulez du login/mot de passe local et/ou de l'authentification LDAP.

## Démarrage (développement)

```bash
cd server
npm install
cp .env.example .env
# Éditez .env : au minimum JWT_SECRET (voir les commentaires dans le fichier),
# et mettez COOKIE_SECURE=false puisqu'il n'y a pas de HTTPS en local.
npm run create-user -- admin MotDePasseSolide123 "Administrateur"
npm start
```

Le service écoute sur `http://127.0.0.1:4000` (port configurable). Lancez ensuite le frontend (`npm run dev` à la racine du dépôt) : il détecte automatiquement le backend et affiche les options de connexion locale/LDAP dans l'onglet Paramètres et sur l'écran de connexion.

## Programme du jour par mail

Le service peut envoyer à chaque membre de l'équipe son programme de la journée : ses
créneaux du matin et de l'après-midi, et ses tâches ouvertes. C'est un message du **matin**,
qui annonce ce qui est prévu — il ne contient aucun temps saisi, qui n'existe pas encore
quand il part.

Le service ne délivre rien lui-même : il remet le message à un **relais SMTP** (Exchange,
Microsoft 365, relais interne). Configurez `SMTP_HOST`, `SMTP_FROM` et, si le relais l'exige,
`SMTP_USER` / `SMTP_PASS` dans `.env` — voir `.env.example` pour le détail commenté. Sans
`SMTP_HOST` ni `SMTP_FROM`, la fonction est simplement annoncée indisponible dans
l'application et rien d'autre ne change.

Chaque personne doit avoir une **adresse mail** renseignée dans l'onglet Équipe ; sans
adresse, elle est signalée comme telle et ne reçoit rien — ce n'est pas une erreur.

L'envoi se déclenche à la main depuis l'onglet **Activité du jour** (bouton « Programme par
mail », avec aperçu du message avant envoi et résultat détaillé destinataire par
destinataire). Pour un envoi automatique quotidien, renseignez `DAILY_MAIL_AT` (format
`HH:MM`, heure du serveur). Si le service est arrêté à l'heure dite, l'envoi part au
redémarrage le même jour plutôt que d'être sauté, et jamais deux fois dans la journée.

## Seuil de présence du service

`config.json`, clé `service.seuilPresence` (0 → 1, 0,5 par défaut). Lu par
`GET /api/data/service-config`, ouvert à toute session parce que l'alerte doit s'afficher
pour tout le monde ; écrit par `PUT /api/data/service-config`, **réservé à
l'administrateur** — abaisser le seuil ferait taire l'alerte pour toute l'équipe.

Côté serveur et non dans le navigateur : rangé dans le stockage local, chacun aurait le
sien, et deux personnes regardant le même planning n'y verraient pas la même alerte. En
mode autonome la valeur d'origine s'applique et le réglage est annoncé indisponible.

## Météo de la semaine votée, anonymement

Chaque membre dépose une voix (ensoleillé, éclaircies, nuageux, orageux) depuis « Ma
journée », du jeudi matin au vendredi à l'heure de clôture — `config.json`, clé
`service.meteoCloture` (heure pleine, 15 par défaut, modifiable dans Paramètres par
l'administrateur). Routes : `GET/POST/PATCH /api/data/meteo/:semaine`, la semaine étant
la date du **lundi**.

L'anonymat tient à la façon dont c'est rangé, pas à une promesse d'interface :

- `data/meteo-votes.json` ne porte **aucune identité** : semaine, niveau, mot éventuel, et
  un identifiant aléatoire sans rapport avec la personne ;
- `data/meteo-jetons.json` ne porte **aucune voix** : l'empreinte HMAC-SHA256 de
  l'identifiant de session, de la semaine et du secret du serveur. Elle suffit à refuser
  un second vote, elle ne se retourne pas en identifiant ;
- ni horodatage, ni ordre d'arrivée : les deux listes sont remélangées à chaque écriture,
  faute de quoi, à cinq, la première voix du jeudi matin s'attribuerait toute seule.

Conséquence assumée : le serveur ne sait pas quelle voix est la vôtre, donc **seul le
navigateur qui l'a déposée** peut la modifier (il conserve l'identifiant remis au dépôt).
Changer de poste, ou effacer son stockage local, coûte cette possibilité — l'interface le
dit au lieu de laisser croire à un bogue.

Le rapport de réunion affiche la météo votée **à côté** du score calculé, jamais à la
place : l'écart entre les deux est l'information la plus utile des deux. En dessous de
trois voix, ou tant que le vote est ouvert, c'est le score calculé qui est affiché, avec
la raison écrite noir sur blanc. Les voix de plus de 53 semaines sont effacées.

Ces voix ne sont volontairement **pas** une collection partagée : l'instantané
`GET /api/data/` part à tout le monde et se retrouve dans les sauvegardes du navigateur.

## Modifier un champ, le vider : `null` veut dire « retire-le »

Un `PATCH` sur une tâche, une fiche d'équipe, une initiative FDR ou un COPIL applique les
champs reçus et **supprime ceux reçus à `null`** (voir `appliquerPatch` dans
`businessData.js`). Le navigateur ne peut pas dire « vide ce champ » autrement :
`JSON.stringify({ dueDate: undefined })` produit `{}` — la modification partait amputée, le
serveur ne voyait rien à changer et renvoyait l'ancienne valeur. Effacer une échéance, un
projet ou un demandeur semblait alors marcher, jusqu'au rechargement.

Cela ne vaut pas pour `PUT /api/data/service-config`, qui n'est pas la modification d'un
enregistrement mais un réglage par champs nommés : un champ absent n'y est pas touché, et
un `null` y est une valeur invalide, refusée.

## Demandes et créneaux horaires des tâches

Deux champs facultatifs de plus sur une tâche, stockés tels quels dans
`data/business-tasks.json` : `demandeur` (texte libre, pour les tâches de nature
`Demande`) et `creneaux`, une liste de `{ id, memberId, date, debut (décimal), duree }`.

Le serveur ne les interprète pas : ce sont des créneaux PRÉVISIONNELS, et c'est le
navigateur qui propose de les valider — une validation produit une saisie de temps
ordinaire (`POST /api/data/time-entries`), avec la durée du créneau et son heure de début.
Rien n'est généré automatiquement, ici non plus : une intervention prévue n'est pas une
intervention faite.

## Créneaux récurrents

`config.json`, clé `service.recurrences` — une liste de `{ id, libelle, jour (1–5), debut
(décimal : 14,5 = 14:30), duree (heures), participants (liste d'identifiants ou null pour
toute l'équipe) }`. Lue par `GET /api/data/service-config`, écrite par `PUT`, **réservé à
l'administrateur**. Liste absente = la réunion d'équipe du vendredi 14:30 → 16:00 ; liste
vide = aucun créneau, et elle le reste (on ne repeuple pas ce qui a été supprimé).

C'est une RÈGLE, pas un enregistrement : rien n'est écrit chaque semaine, les heures sont
déduites à l'affichage (voir `src/lib/recurrences.ts`). Donc pas de doublon à nettoyer,
pas de rattrapage sur les semaines passées — mais, en contrepartie, changer l'horaire
change aussi ce qu'affichent les semaines déjà écoulées, ce que la page Paramètres
annonce.

Ces heures s'ajoutent aux heures saisies dans Activité du jour, Ma journée et le rapport
de réunion. Elles ne comptent pas pour une personne déclarée absente sur la demi-journée,
ni pour une personne ayant saisi son propre temps sur les tranches couvertes, ni pour un
jour à venir — un créneau qui n'a pas encore eu lieu n'est pas du temps passé.

## Journal d'avancement

Une huitième collection partagée, `journalEntries` (fichier `data/business-journalEntries.json`),
porte le fil de chaque tâche : les notes écrites à la main et les changements enregistrés
automatiquement par le navigateur (statut, priorité, échéance, assignation).

Le serveur **enregistre ce qu'on lui donne** plutôt que de recalculer les entrées
automatiques à partir du `PATCH` de la tâche : les recalculer imposerait de dupliquer la
logique de comparaison, et l'entrée porterait un autre identifiant que celui que le
navigateur affiche déjà — il faudrait alors réconcilier. Une entrée rattachée à une tâche
inconnue est refusée : elle ne serait jamais lue.

Pas de contrôle de concurrence sur cette collection : une entrée s'ajoute, elle n'est jamais
réécrite par quelqu'un d'autre. Deux personnes qui commentent en même temps produisent deux
entrées — exactement ce qu'on veut, contrairement à une tâche où la seconde écriture
écraserait la première. Seules les notes sont modifiables (`PATCH /api/data/journal-entries/:id`) ;
une entrée automatique est un fait, pas un avis.

Le fil part avec sa tâche, à la suppression comme à la purge. En revanche, **une tâche
terminée qui porte au moins une note n'est pas purgée** au bout de dix jours : quelqu'un a
pris la peine de l'expliquer, et c'est six mois plus tard qu'on y revient. Les entrées
automatiques ne comptent pas — toute tâche en a, et plus rien ne serait jamais purgé.

## Rapport de réunion par mail

Le même relais SMTP sert à envoyer le **rapport de réunion** préparé dans l'onglet Rapport
(bouton « Envoyer par mail… »). Un seul message, à tous les destinataires en copie visible :
contrairement au programme du jour, qui est personnel et part donc en autant de messages que
de personnes, le rapport est le même pour tout le monde et les destinataires ont intérêt à
savoir qui d'autre l'a reçu.

Le corps du message est la **synthèse** (lisible sur un téléphone) ; le **document complet**
est joint en fichier `.html` autonome, qui s'ouvre d'un double-clic et s'imprime en PDF. Pas
de PDF généré côté serveur : cela imposerait d'embarquer un navigateur sans interface
(≈ 300 Mo à installer et à maintenir) pour un résultat que l'impression du fichier joint
donne déjà.

Le navigateur envoie au serveur des **chiffres et des libellés déjà calculés**, jamais du
HTML (voir `src/lib/reunionPayload.ts` côté application et `src/mail/reunionReport.js` ici) :
c'est le serveur qui met en page et qui échappe le contenu. Refaire le calcul côté serveur
imposerait de maintenir deux fois la même logique métier, et un rapport envoyé qui ne dit pas
la même chose que l'écran serait pire que pas de rapport du tout.

Routes (toutes derrière une session, voir `src/routes/mail.js`) :

| Route | Rôle |
|---|---|
| `GET /api/mail/rapport-reunion/config` | destinataires extérieurs enregistrés, trace du dernier envoi |
| `PUT /api/mail/rapport-reunion/config` | modifie cette liste — **administrateur uniquement** : ajouter une adresse, c'est décider qui reçoit l'activité de l'équipe |
| `POST /api/mail/rapport-reunion/apercu` | qui serait joignable, sans rien envoyer |
| `POST /api/mail/rapport-reunion/document` | le document complet en HTML (bouton « Télécharger ») |
| `POST /api/mail/rapport-reunion` | l'envoi |
| `GET /api/mail/rapport-reunion/envois` | historique (30 derniers) |
| `GET /api/mail/rapport-reunion/envois/:id` | le document **tel qu'il est parti** |

Les envois sont conservés dans `data/config.json`, document compris : un rapport se
recalcule, un envoi non — c'est la seule trace de ce qu'on avait annoncé en octobre quand on
le relit en novembre. Les trente derniers sont gardés, au-delà les plus anciens sont oubliés.

Déclenchement **à la demande uniquement** : il n'y a pas d'équivalent de `DAILY_MAIL_AT` pour
le rapport de réunion. Rien ne part sans un clic, après relecture et choix des destinataires.

## Déploiement en production

Voir [`../DEPLOYMENT.md`](../DEPLOYMENT.md), section "Service Windows + authentification" : ce service tourne en tâche de fond (Windows Service via NSSM) et IIS lui relaie les appels `/api/*`, tout en continuant de servir le reste de l'application en HTTPS.

## Ce que fait — et ne fait pas — ce service

- Il **vérifie des identifiants** (local, LDAP) et **valide un jeton SSO** Microsoft déjà obtenu côté navigateur, puis émet une session.
- Il **ne stocke aucun mot de passe en clair** : les comptes locaux sont hachés (bcrypt) ; pour LDAP, le mot de passe n'est jamais conservé, seulement transmis le temps de la vérification ("bind" LDAP).
- Il **stocke les données métier** de l'équipe (membres, tâches, planning, temps saisi, absences, feuille de route, COPIL) dans `data/business-*.json` : en mode client/serveur, c'est lui la source de vérité, pas le navigateur (voir `src/businessData.js`).
- Il **envoie le programme du jour** par mail si un relais SMTP est configuré (voir plus haut).
