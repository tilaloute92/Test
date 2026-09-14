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

## Déploiement en production

Voir [`../DEPLOYMENT.md`](../DEPLOYMENT.md), section "Service Windows + authentification" : ce service tourne en tâche de fond (Windows Service via NSSM) et IIS lui relaie les appels `/api/*`, tout en continuant de servir le reste de l'application en HTTPS.

## Ce que fait — et ne fait pas — ce service

- Il **vérifie des identifiants** (local, LDAP) et **valide un jeton SSO** Microsoft déjà obtenu côté navigateur, puis émet une session.
- Il **ne stocke aucun mot de passe en clair** : les comptes locaux sont hachés (bcrypt) ; pour LDAP, le mot de passe n'est jamais conservé, seulement transmis le temps de la vérification ("bind" LDAP).
- Il **stocke les données métier** de l'équipe (membres, tâches, planning, temps saisi, absences, feuille de route, COPIL) dans `data/business-*.json` : en mode client/serveur, c'est lui la source de vérité, pas le navigateur (voir `src/businessData.js`).
- Il **envoie le programme du jour** par mail si un relais SMTP est configuré (voir plus haut).
