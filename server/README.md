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

## Déploiement en production

Voir [`../DEPLOYMENT.md`](../DEPLOYMENT.md), section "Service Windows + authentification" : ce service tourne en tâche de fond (Windows Service via NSSM) et IIS lui relaie les appels `/api/*`, tout en continuant de servir le reste de l'application en HTTPS.

## Ce que fait — et ne fait pas — ce service

- Il **vérifie des identifiants** (local, LDAP) et **valide un jeton SSO** Microsoft déjà obtenu côté navigateur, puis émet une session.
- Il **ne stocke aucun mot de passe en clair** : les comptes locaux sont hachés (bcrypt) ; pour LDAP, le mot de passe n'est jamais conservé, seulement transmis le temps de la vérification ("bind" LDAP).
- Il **ne stocke pas les données métier** de l'application (tâches, planning, temps saisi...) : celles-ci restent dans le navigateur de chaque utilisateur (`localStorage`), inchangé. Ce service ne gère que "qui a le droit d'ouvrir l'application", pas son contenu.
