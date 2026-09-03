# Suivi Infra & Réseau

Application de suivi d'activité pour une équipe infrastructures systèmes & réseau (6 personnes), pensée pour un chef d'équipe qui veut voir en un coup d'œil qui travaille sur quoi, la charge de chacun et le planning prévisionnel sur 3 semaines.

## Fonctionnement métier

- Volume hebdomadaire cible de 35h par personne (modifiable individuellement dans l'onglet Équipe), journée coupée en deux : **matin = MCO & incidents**, **après-midi = projets**.
- Chaque demi-journée (3,5h) est un créneau qu'on affecte à une tâche, **du lundi au dimanche** — l'équipe travaillant aussi le week-end et en horaires décalés, samedi et dimanche sont des jours planifiables comme les autres (repérés par un léger fond ambré dans les grilles).
- La charge de chacun se compare à son propre volume hebdomadaire, pas au nombre de jours affichés à l'écran : ajouter le week-end à la grille ne gonfle donc la charge de personne. Si quelqu'un est planifié au-delà de son volume (ex. week-end en plus d'une semaine déjà pleine), le dépassement se voit directement : le niveau "Surchargé" (> 105%) devient atteignable, ce qui n'était pas le cas avant.

## Fonctionnalités

- **Vue d'ensemble** : charge de la semaine par personne (sous-chargé / équilibré / chargé / surchargé) pour repérer un déséquilibre et rééquilibrer la répartition, tâche en cours de chacun, indicateurs (incidents ouverts, tâches en retard, présence du jour).
- **Activité du jour** : ce que fait chaque personne ce matin / cet après-midi, changement de statut et saisie du temps passé en direct.
- **Planning 3 semaines** : aperçu compact des 3 semaines (mini-calendrier par personne) + vue détaillée de la semaine sélectionnée sous forme de calendrier (une carte par créneau, icône + titre de tâche, code couleur MCO / Incident / Projet), avec gestion des absences et navigation par onglets de semaine.
- **Tâches, incidents & projets** : liste filtrable/éditable (type, priorité, statut, charge estimée vs temps passé, échéance). Une tâche peut être assignée à **plusieurs personnes à la fois** (avatars empilés, menu à cocher) — utile pour un incident ou un projet traité à plusieurs ; chaque personne assignée le retrouve dans sa propre activité du jour et son propre planning.
- **Suivi du temps** : récapitulatif hebdomadaire par personne vs cible 35h, détail des saisies, export CSV.
- **Équipe** : fiches membres éditables (rôle, compétences, volume horaire), gestion des absences/indisponibilités par plage de dates (congés, formation, télétravail, astreinte) qui viennent réduire la capacité disponible.
- **Requêtes API** : console pour interroger des applications externes (ticketing, supervision...) depuis le navigateur — connexions réutilisables (URL de base, authentification none/Bearer/clé API/Basic, en-têtes par défaut), éditeur de requête (méthode, chemin, en-têtes, corps JSON), réponse formatée et historique des derniers appels.

- **Rapport hebdomadaire** : à générer le vendredi (ou n'importe quand) — météo de la semaine (☀️/🌤️/☁️/⛈️) calculée à partir de la charge moyenne, des incidents critiques encore ouverts, des tâches en retard et du nombre de personnes en surcharge (facteurs toujours affichés, jamais une boîte noire), indicateurs clés, charge par personne, faits marquants (incidents ouverts/résolus, tâches terminées/en retard), aperçu de la semaine suivante. Export en Markdown (presse-papiers, pour coller dans un e-mail/Teams) ou impression/PDF via le navigateur.
- **Paramètres** : authentification (SSO Microsoft, comptes locaux, LDAP/Active Directory), statut HTTPS, guide de déploiement, et **sauvegarde & historique des versions** — un point de restauration est enregistré automatiquement après chaque modification (membres, tâches, planning, temps, absences, connexions API, paramètres de connexion), pour revenir en arrière rapidement en cas de mauvaise manipulation ; chaque restauration conserve d'abord l'état actuel dans l'historique, elle est donc elle-même annulable. En complément, "Télécharger une sauvegarde (.json)" / "Restaurer depuis un fichier" permet une sauvegarde manuelle qui, elle, survit à un vidage du stockage du navigateur ou à un changement de poste — voir la section dédiée ci-dessous.
- **Confirmation systématique** : toute suppression et toute modification d'une donnée existante (changement de statut/priorité/assigné, réaffectation dans le planning, édition d'un membre ou d'une connexion API, activation de la connexion obligatoire...) déclenche une demande de confirmation avant d'être appliquée. Annuler laisse la donnée strictement inchangée. La création de nouvelles données (nouvelle tâche, nouveau membre, nouvelle absence...) n'est pas concernée — elle passe déjà par un formulaire explicite avec un bouton dédié.

Le rapport hebdomadaire se génère à la demande, pas automatiquement : rien ne peut se déclencher tout seul le vendredi ni envoyer un e-mail à votre place — il faut ouvrir l'onglet Rapport et utiliser "Copier en Markdown" ou "Imprimer / Enregistrer en PDF" pour le partager.

Les données métier (tâches, planning, temps saisi...) sont stockées dans le navigateur (`localStorage`) de chaque utilisateur, avec ou sans le serveur d'authentification. Les appels API de l'onglet Requêtes API sont exécutés directement par le navigateur : l'application distante doit autoriser le CORS depuis cette page, sinon la requête est bloquée. Par défaut les secrets d'authentification de cet onglet ne sont pas mémorisés (à ressaisir à chaque session) ; l'option "mémoriser" les enregistre en clair dans le stockage local du navigateur.

## Authentification, annuaire et HTTPS

Trois façons de se connecter, configurables dans l'onglet **Paramètres** :

- **SSO Microsoft Entra ID** : fonctionne pour tout compte présent dans Entra ID (Azure AD), y compris les comptes AD locaux synchronisés via Azure AD Connect. Aucun secret d'application n'est nécessaire côté navigateur (flux OAuth "client public" + PKCE). C'est la seule méthode qui fonctionne même **sans** le serveur d'authentification (voir `server/`) — dans ce cas la session reste gérée par le navigateur seul, comme avant.
- **Compte local (identifiant + mot de passe)** et **LDAP/Active Directory** : nécessitent le petit serveur d'authentification optionnel du dossier [`server/`](./server/README.md) — un navigateur ne peut techniquement pas vérifier un mot de passe en sécurité, ni dialoguer en LDAP, tout seul. Ce serveur hache les mots de passe locaux (jamais stockés en clair), ne conserve jamais un mot de passe LDAP (vérifié par "bind" direct auprès du contrôleur de domaine), et ouvre une session signée (cookie httpOnly) commune aux trois méthodes de connexion — y compris le SSO, dont le jeton est alors vérifié côté serveur avant d'ouvrir la session, ce qui en fait une vraie barrière serveur et pas seulement un contrôle d'interface (voir la section Sécurité ci-dessous).
- Dans les deux cas, un interrupteur "Exiger la connexion" rend l'authentification obligatoire pour ouvrir l'app ; la page Paramètres reste toujours accessible depuis l'écran de connexion pour éviter tout blocage en cas de mauvaise configuration.
- **Certificat SSL/HTTPS** : se configure toujours au niveau du serveur qui héberge les fichiers (IIS, nginx, reverse proxy...), jamais dans l'application. Il n'y a donc pas de formulaire pour importer un certificat dans l'app (un tel formulaire exposerait des clés privées dans le navigateur, ce qui serait une faille de sécurité) — la page Paramètres affiche un statut HTTPS en direct et un guide de déploiement IIS pas à pas.

## Sauvegarde et versionnement

Onglet **Paramètres**, section "Sauvegarde & historique des versions". Deux mécanismes complémentaires :

- **Historique automatique** : après chaque modification (statut, planning, membre, absence, connexion API, paramètres de connexion...), l'état complet des données est enregistré tout seul dans le stockage local du navigateur. La section liste les derniers points (jusqu'à 30) avec date/heure et un résumé, chacun restaurable en un clic (confirmation demandée, comme pour toute modification). Restaurer un point conserve d'abord l'état actuel dans l'historique : une restauration se défait donc, elle aussi, en restaurant le point juste avant.
- **Sauvegarde manuelle (fichier .json)** : "Télécharger une sauvegarde" produit un fichier téléchargeable à archiver où vous voulez (partage réseau, e-mail...) ; "Restaurer depuis un fichier" le relit et remplace les données actuelles après confirmation. C'est la seule des deux méthodes qui survit à un vidage du stockage local du navigateur ou à un changement de poste — l'historique automatique, lui, est propre à ce navigateur.

Comme pour le reste des données métier, rien n'est envoyé à un serveur : l'historique automatique reste dans `localStorage`, et le fichier de sauvegarde n'existe que là où vous le téléchargez.

## Sécurité

Vérifié dans le code (au dernier commit) :

- **Dépendances** : `npm audit` ne remonte aucune vulnérabilité connue (0 critique/haute/moyenne/basse). À relancer avant chaque nouveau build, ce n'est valable qu'à l'instant où c'est exécuté.
- **XSS** : aucun `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni équivalent dans le code — tout le contenu (y compris les réponses de l'onglet Requêtes API) passe par le rendu JSX habituel de React, qui échappe automatiquement le texte affiché.
- **Secrets** : aucun secret n'est codé en dur. Les jetons/API keys saisis dans l'onglet Requêtes API ne sont écrits dans le stockage local que si l'utilisateur coche explicitement "mémoriser" — sinon ils restent en mémoire le temps de la session. Le SSO Entra ID n'utilise ni ne stocke de secret d'application (flux "client public" + PKCE).
- **Build** : aucun script inline dans le HTML généré (`script-src 'self'` fonctionne sans exception), pas de source maps publiées.
- **En-têtes HTTP** : Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy et Strict-Transport-Security sont fournis via `public/web.config` (inclus automatiquement dans chaque `dist/`) — testés sans aucune violation CSP sur tous les onglets de l'application. Le détail et la justification de chaque règle sont commentés dans ce fichier.

Limites à connaître :

- **Sans le serveur d'authentification (`server/`), le verrou de connexion est un contrôle d'interface, pas une barrière de sécurité serveur.** Il masque l'application tant qu'on n'est pas connecté, mais les données restent dans le stockage local du navigateur : quelqu'un avec un accès physique/technique à l'appareil (outils de développement du navigateur) pourrait les consulter directement. **Avec** le serveur d'authentification, la connexion devient une vraie barrière (session vérifiée côté serveur à chaque appel, mots de passe locaux hachés, mots de passe LDAP jamais stockés) — mais les données métier de l'application (tâches, planning...) continuent, elles, de résider uniquement dans le navigateur de chaque utilisateur : le serveur ne protège l'accès à l'application, pas ces données une fois qu'on y est.
- **Aucune donnée métier n'est centralisée** : chaque utilisateur a sa propre copie locale (planning, tâches, temps saisi). Rien n'est partagé automatiquement entre collègues, et rien n'est sauvegardé côté serveur — que le serveur d'authentification soit déployé ou non. L'historique de versions (voir section dédiée ci-dessus) est un filet de sécurité local, pas une sauvegarde centralisée : pensez à exporter régulièrement un fichier de sauvegarde si vous voulez une copie qui survive à cet ordinateur.
- Je peux vérifier le code et les pratiques (c'est ce qui précède), mais je ne peux pas **certifier** une conformité formelle (ISO 27001, référentiel ANSSI, audit RGPD...) : ces démarches impliquent des processus organisationnels (gestion des accès physiques, politique de mots de passe, registre de traitement des données, etc.) qui dépassent le code de l'application.

## Déploiement

Guide détaillé pas à pas pour Windows Server 2022 (IIS) : voir [`DEPLOYMENT.md`](./DEPLOYMENT.md) — hébergement du site statique (obligatoire) et, si besoin, du serveur d'authentification optionnel (`server/`, voir aussi [`server/README.md`](./server/README.md)) pour le login local et LDAP.

## Démarrage

```bash
npm install
npm run dev
```

Pour tester aussi l'authentification locale/LDAP en développement, lancez en plus le serveur (voir [`server/README.md`](./server/README.md)) :

```bash
cd server
npm install
cp .env.example .env   # éditez JWT_SECRET et mettez COOKIE_SECURE=false
npm run create-user -- admin MotDePasseSolide123 "Administrateur"
npm start
```

## Build

```bash
npm run build
```
