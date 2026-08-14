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

## Démarrage

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
