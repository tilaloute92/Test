# Suivi Infra & Réseau

Application de suivi d'activité pour une équipe infrastructures systèmes & réseau (6 personnes), pensée pour un chef d'équipe qui veut voir en un coup d'œil qui travaille sur quoi, la charge de chacun et le planning prévisionnel sur 3 semaines.

## Fonctionnement métier

- Semaine à 35h, journée coupée en deux : **matin = MCO & incidents**, **après-midi = projets**.
- Chaque demi-journée (3,5h) est un créneau qu'on affecte à une tâche.

## Fonctionnalités

- **Vue d'ensemble** : charge de la semaine par personne (sous-chargé / équilibré / chargé / surchargé) pour repérer un déséquilibre et rééquilibrer la répartition, tâche en cours de chacun, indicateurs (incidents ouverts, tâches en retard, présence du jour).
- **Activité du jour** : ce que fait chaque personne ce matin / cet après-midi, changement de statut et saisie du temps passé en direct.
- **Planning 3 semaines** : grille équipe × jours × créneaux (matin/après-midi) avec code couleur MCO / Incident / Projet et gestion des absences, pour visualiser et réaffecter la charge prévisionnelle.
- **Tâches, incidents & projets** : liste filtrable/éditable (type, priorité, statut, assignation, charge estimée vs temps passé, échéance).
- **Suivi du temps** : récapitulatif hebdomadaire par personne vs cible 35h, détail des saisies, export CSV.
- **Équipe** : fiches membres éditables (rôle, compétences, volume horaire), gestion des absences/indisponibilités par plage de dates (congés, formation, télétravail, astreinte) qui viennent réduire la capacité disponible.
- **Requêtes API** : console pour interroger des applications externes (ticketing, supervision...) depuis le navigateur — connexions réutilisables (URL de base, authentification none/Bearer/clé API/Basic, en-têtes par défaut), éditeur de requête (méthode, chemin, en-têtes, corps JSON), réponse formatée et historique des derniers appels.

- **Paramètres** : connexion automatique via SSO Microsoft Entra ID, statut HTTPS et guide de déploiement. Voir la section dédiée ci-dessous pour les détails et les limites.

Les données sont stockées dans le navigateur (`localStorage`) ; aucun backend n'est requis pour ce prototype. Les appels API sont exécutés directement par le navigateur : l'application distante doit autoriser le CORS depuis cette page, sinon la requête est bloquée. Par défaut les secrets d'authentification ne sont pas mémorisés (à ressaisir à chaque session) ; l'option "mémoriser" les enregistre en clair dans le stockage local du navigateur.

## Authentification, annuaire et HTTPS

L'application reste un site 100% statique (pas de serveur, pas de base de données), ce qui **contraint** ce qui est réellement possible en matière d'authentification et de sécurité réseau. Tout se configure dans l'onglet **Paramètres** :

- **SSO Microsoft Entra ID (fonctionnel)** : le seul mode de connexion automatique possible sans serveur. Fonctionne pour tout compte présent dans Entra ID (Azure AD), y compris les comptes AD locaux synchronisés via Azure AD Connect. Aucun secret d'application n'est nécessaire (flux OAuth "client public" + PKCE) — seuls l'ID d'annuaire (tenant) et l'ID d'application (client), qui ne sont pas sensibles, sont saisis et stockés. Un interrupteur "Exiger la connexion" rend le SSO obligatoire pour ouvrir l'app ; la page Paramètres reste toujours accessible depuis l'écran de connexion pour éviter tout blocage en cas de mauvaise configuration.
- **Active Directory local pur (LDAP)** : **non disponible** sans backend. Un navigateur ne peut pas dialoguer en LDAP (protocole non-web). Si une partie de vos comptes n'est pas synchronisée vers Entra ID, il faudrait ajouter un petit service serveur (ex. Node.js + `ldapjs`) qui interroge le contrôleur de domaine — non inclus ici, car ça change le mode d'hébergement (plus un simple site statique).
- **Certificat SSL/HTTPS** : se configure toujours au niveau du serveur qui héberge les fichiers (IIS, nginx, reverse proxy...), jamais dans l'application. Il n'y a donc pas de formulaire pour importer un certificat dans l'app (un tel formulaire exposerait des clés privées dans le navigateur, ce qui serait une faille de sécurité) — la page Paramètres affiche un statut HTTPS en direct et un guide de déploiement IIS pas à pas.

## Sécurité

Vérifié dans le code (au dernier commit) :

- **Dépendances** : `npm audit` ne remonte aucune vulnérabilité connue (0 critique/haute/moyenne/basse). À relancer avant chaque nouveau build, ce n'est valable qu'à l'instant où c'est exécuté.
- **XSS** : aucun `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni équivalent dans le code — tout le contenu (y compris les réponses de l'onglet Requêtes API) passe par le rendu JSX habituel de React, qui échappe automatiquement le texte affiché.
- **Secrets** : aucun secret n'est codé en dur. Les jetons/API keys saisis dans l'onglet Requêtes API ne sont écrits dans le stockage local que si l'utilisateur coche explicitement "mémoriser" — sinon ils restent en mémoire le temps de la session. Le SSO Entra ID n'utilise ni ne stocke de secret d'application (flux "client public" + PKCE).
- **Build** : aucun script inline dans le HTML généré (`script-src 'self'` fonctionne sans exception), pas de source maps publiées.
- **En-têtes HTTP** : Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy et Strict-Transport-Security sont fournis via `public/web.config` (inclus automatiquement dans chaque `dist/`) — testés sans aucune violation CSP sur tous les onglets de l'application. Le détail et la justification de chaque règle sont commentés dans ce fichier.

Limites à connaître, propres à une application 100% statique (pas de serveur) — aucune ne peut être levée sans en ajouter un :

- **Le verrou de connexion (onglet Paramètres) est un contrôle d'interface, pas une barrière de sécurité serveur.** Il masque l'application tant qu'on n'est pas connecté, mais les données restent dans le stockage local du navigateur : quelqu'un avec un accès physique/technique à l'appareil (outils de développement du navigateur) pourrait les consulter directement. Pour une confidentialité réellement opposable, il faudrait un backend qui ne renvoie les données qu'après vérification d'un jeton — hors périmètre actuel (cf. votre choix de rester sans serveur).
- **Aucune donnée n'est centralisée** : chaque utilisateur a sa propre copie locale (planning, tâches, temps saisi). Rien n'est partagé automatiquement entre collègues, et rien n'est sauvegardé côté serveur.
- Je peux vérifier le code et les pratiques (c'est ce qui précède), mais je ne peux pas **certifier** une conformité formelle (ISO 27001, référentiel ANSSI, audit RGPD...) : ces démarches impliquent des processus organisationnels (gestion des accès physiques, politique de mots de passe, registre de traitement des données, etc.) qui dépassent le code de l'application.

## Déploiement

Guide détaillé pas à pas pour Windows Server 2022 (IIS) : voir [`DEPLOYMENT.md`](./DEPLOYMENT.md). L'application est un site 100% statique (pas de Node.js à installer sur le serveur de production) — seul IIS sert les fichiers générés par `npm run build`.

## Démarrage

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
