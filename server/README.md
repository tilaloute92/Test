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
