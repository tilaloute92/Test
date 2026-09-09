# Cahier des charges — Suivi Infra & Réseau

> **À quoi sert ce document.** Il décrit l'application dans son intégralité : ce qui a été
> demandé, les règles métier exactes, l'architecture et les décisions de conception. Il est
> écrit pour être **soumis tel quel à un assistant IA** afin de reconstruire l'application
> complètement, sans avoir à re-expliquer le contexte.
>
> **Version décrite** : 1.0.1 — dépôt `tilaloute92/Test`, branche
> `claude/team-activity-tracking-infra-969r4y`.
> Document généré le 5 septembre 2026 à partir du code réel du dépôt.

---

## 0. Instruction de reconstruction

Si vous soumettez ce document pour refaire l'application, l'instruction attendue est :

> « Reconstruis intégralement l'application décrite dans ce cahier des charges. Respecte
> les règles transverses de la section 3 — elles ne sont pas négociables et conditionnent
> la confiance dans l'outil. Vérifie chaque fonctionnalité dans un vrai navigateur avant de
> déclarer qu'elle marche. »

Trois exigences ont structuré tout le développement et doivent être reprises :

1. **Rien ne doit faire semblant de fonctionner.** Pas de bouton décoratif, pas de vue en
   lecture seule déguisée en vue modifiable, pas de statut calculé « à l'œil ».
2. **Toute modification ou suppression d'une donnée existante demande confirmation.** La
   création, elle, n'en demande pas (elle passe déjà par un formulaire explicite).
3. **Jamais de boîte noire.** Tout indicateur calculé (météo, statut Rouge/Orange/Vert,
   point d'attention) affiche **les raisons** qui l'ont produit.

---

## 1. Contexte et utilisateur

- **Utilisateur principal** : un chef d'équipe « infrastructures systèmes et réseau ».
- **Équipe** : 6 personnes (administrateurs systèmes, ingénieurs réseau, technicien support,
  ingénieure cloud).
- **Besoin** : voir en un coup d'œil qui travaille sur quoi, la charge de chacun, le planning
  prévisionnel, et piloter projets, feuille de route et comités de pilotage.
- **Langue de l'interface** : **français** (libellés, messages, exports).
- **Déploiement cible** : réseau interne d'entreprise, **Windows Server 2022 + IIS**.

---

## 2. Chronologie des demandes

Les demandes ont été faites successivement ; chacune est un commit du dépôt.

| # | Demande | Livré |
|---|---|---|
| 1 | Application de suivi d'activité pour l'équipe (base) | Onglets Vue d'ensemble, Activité du jour, Planning 3 semaines, Tâches, Temps, Équipe |
| 2 | Absences par plage de dates + édition des membres | Formulaire de plage, fiches membres éditables |
| 3 | Console de requêtes API vers applis externes | Onglet API |
| 4 | SSO Microsoft + page de paramètres honnête sur LDAP/HTTPS | Entra ID (PKCE), page Paramètres |
| 5 | Revue de sécurité + guide de déploiement Windows Server 2022 | `DEPLOYMENT.md`, `web.config`, en-têtes de sécurité |
| 6 | **Confirmation avant chaque suppression et chaque modification** | `ConfirmProvider` global |
| 7 | Refonte visuelle du planning + rapport hebdomadaire avec « météo » | Onglet Rapport |
| 8 | Backend d'authentification optionnel (local + LDAP + SSO vérifié serveur) | Dossier `server/` |
| 9 | Plusieurs personnes assignables à une même tâche | `assigneeIds[]` |
| 10 | Semaine de 7 jours (week-end travaillé, horaires décalés) | Grilles lundi→dimanche |
| 11 | Versionnement + sauvegarde/restauration | Historique auto + export/import `.json` |
| 12 | **Onglet FDR** (feuille de route annuelle et pluriannuelle) | Onglet FDR |
| 13 | Export/impression de chaque onglet + état FDR dans le rapport | Bouton Imprimer/PDF partout |
| 14 | Formulaire complet de modification des tâches | (avant : suppression seule) |
| 15 | Export PowerPoint de la FDR | (déplacé ensuite, voir #16) |
| 16 | Déplacer le PPTX vers le rapport, le sécuriser, **ajouter des flash reports projet** | Statut RAG + export PPTX |
| 17 | Analyse d'amélioration (sans implémentation), puis les 3 priorités retenues | Points d'attention, couleurs unifiées, nav groupée |
| 18 | **Multi-utilisateur** + **3 modes d'affichage** sur FDR, Rapport, Tâches, Planning | Données partagées + sélecteurs de mode |
| 19 | 3 modes aussi sur Vue d'ensemble et Activité du jour + **détail des points d'attention sans changer d'onglet** | Points d'attention dépliables |
| 20 | **Onglet COPIL**, placé juste après FDR | Onglet COPIL |
| 21 | Binaires + procédure d'installation Windows Server 2022 | Paquet `.zip` + scripts PowerShell |
| 22 | Correction : l'affectation d'une tâche cochait un autre utilisateur | Correctif identifiants + réparation |
| 23 | Compte rendu de tout ce qui a été demandé, resoumettable pour reconstruire l'application | Ce document |
| 24 | **Mode client/serveur** avec un serveur Windows Server 2022 | Serveur = source de vérité, mode mémorisé, conflits détectés |

---

## 3. Règles transverses (non négociables)

### 3.1 Confirmation systématique

Déclenchent une **demande de confirmation** : toute suppression, et toute **modification
d'une donnée existante** — changement de statut, de priorité, d'assigné, réaffectation d'un
créneau de planning, édition d'un membre, d'une connexion API, activation de la connexion
obligatoire, modification d'une action de COPIL, etc. Annuler laisse la donnée **strictement
inchangée**.

Ne déclenchent **pas** de confirmation : les créations (nouvelle tâche, nouveau membre,
nouvelle absence, ajout d'un point d'ordre du jour…), qui passent déjà par un formulaire
explicite avec bouton dédié.

Implémentation : un `ConfirmProvider` React expose un `confirm()` renvoyant une promesse.
Les suppressions utilisent une variante « danger » (bouton rouge).

### 3.2 Jamais de boîte noire

Chaque indicateur calculé affiche ses raisons :

- la **météo** du rapport hebdomadaire liste les facteurs qui l'ont déterminée ;
- le **statut RAG** d'un flash report liste toujours `ragReasons[]` ;
- les **points d'attention** se déplient pour montrer les éléments concernés.

### 3.3 Impression / export sur chaque onglet

Un bouton « Imprimer / PDF » en haut de **chaque** onglet. À l'impression : les éléments
d'interface (filtres, boutons, formulaires, sélecteurs de mode) sont masqués via
`print:hidden`, le thème sombre est neutralisé, et un en-tête imprimable (`PrintHeader`)
donne le contexte. **Aucun mode d'affichage ne doit produire une impression vide.**

### 3.4 Convention de couleurs (sémantique, pas décorative)

| Couleur | Signification | Jamais utilisée pour |
|---|---|---|
| Rouge | Danger/urgence : priorité critique, RAG Rouge, surcharge, retard | Une simple catégorie |
| Ambre | Attention : priorité haute, RAG Orange, « en attente », « reporté » | — |
| Émeraude | Succès : « terminé », RAG Vert, charge équilibrée | — |
| Bleu/ciel | En cours / information neutre | — |
| Ardoise | Neutre/inactif : « à faire », « idée », « abandonné » | — |

Les étiquettes purement catégorielles évitent délibérément ces cinq couleurs (type
« Incident » = fuchsia et non rouge ; domaine FDR « Sécurité » = fuchsia ; « Poste de
travail » = teal) pour ne jamais se faire passer pour un signal de sévérité.

### 3.5 Modes d'affichage

Six onglets proposent **3 modes d'affichage** (sélecteur en haut à droite). Le choix est
**personnel et local au navigateur** (`localStorage`, clé `view-mode:<onglet>`), **jamais
synchronisé** entre collègues. Changer de mode ne change jamais ce qu'on peut faire : un
onglet modifiable reste modifiable dans ses trois modes.

---

## 4. Modèle métier

### 4.1 Règles de fonctionnement

- Volume hebdomadaire cible : **35 h par personne**, modifiable individuellement.
- Journée coupée en deux demi-journées de **3,5 h** :
  **matin = MCO & incidents**, **après-midi = projets**.
- Semaine du **lundi au dimanche** (7 jours) : l'équipe travaille aussi le week-end
  (astreintes, horaires décalés). Samedi et dimanche sont planifiables, repérés par un fond
  ambré léger.
- **La charge se compare au volume hebdomadaire de la personne**, pas au nombre de jours
  affichés : ajouter le week-end à la grille ne gonfle la charge de personne.
- Capacité disponible = `weeklyHours − heures d'absence`. Ratio = `heures planifiées / capacité`.

Seuils de charge (`workloadLevel`) :

| Ratio | Niveau |
|---|---|
| < 0,50 | Sous-chargé |
| 0,50 – 0,85 | Équilibré |
| 0,85 – 1,05 | Chargé |
| > 1,05 | **Surchargé** |

### 4.2 Types de données (TypeScript)

```ts
type TaskType   = 'MCO' | 'Incident' | 'Projet';
type TaskStatus = 'a_faire' | 'en_cours' | 'en_attente' | 'termine';
type Priority   = 'basse' | 'normale' | 'haute' | 'critique';
type Period     = 'matin' | 'apres_midi';
type AbsenceType = 'conge' | 'formation' | 'teletravail' | 'astreinte' | 'autre';

interface TeamMember { id; name; role; skills: string[]; weeklyHours; color; initials; }

interface ProjectTask {
  id; title; type: TaskType; project?;      // `project` regroupe les tâches d'un même projet
  assigneeIds: string[];                    // plusieurs personnes possibles
  status; priority; estimatedHours; dueDate?;
  createdAt; completedAt?; description?;
  updatedAt?; updatedBy?;                   // renseignés par le serveur (mode client/serveur)
}

interface TimeEntry    { id; taskId; memberId; date; period; hours; note?; }
interface PlanningSlot { id; memberId; date; period; taskId: string | null; }
interface Absence      { id; memberId; date; period: Period | 'jour'; type; label?; }

type RoadmapDomain  = 'Infrastructure'|'Réseau'|'Sécurité'|'Cloud'|'Poste de travail'|'Autre';
type RoadmapStatus  = 'idee'|'planifie'|'en_cours'|'termine'|'reporte'|'abandonne';
type RoadmapQuarter = 'T1'|'T2'|'T3'|'T4'|'annee';

interface RoadmapItem {
  id; title; description?; domain; year; quarter; status; priority;
  ownerIds: string[]; progress;             // avancement 0-100 SAISI À LA MAIN
  budgetEstimate?; linkedTaskIds: string[]; // lien de traçabilité vers les tâches
  createdAt; updatedAt; updatedBy?;
}

type CopilStatus = 'planifie' | 'tenu' | 'annule';
interface CopilAgendaItem { id; label; presenterId?; durationMin?; }
interface CopilDecision   { id; label; detail?; }
interface CopilAction     { id; label; ownerIds: string[]; dueDate?; status: TaskStatus; }

interface Copil {
  id; title; date; time?; location?; status;
  participantIds: string[];                 // membres de l'équipe
  externalParticipants: string[];           // texte libre (direction, métiers, prestataires)
  agenda: CopilAgendaItem[]; decisions: CopilDecision[]; actions: CopilAction[];
  roadmapItemIds: string[];                 // initiatives FDR passées en revue
  notes?; nextDate?; createdAt; updatedAt; updatedBy?;
}

interface ApiConnection { id; name; baseUrl; authType: 'none'|'bearer'|'apiKey'|'basic';
                          apiKeyHeader?; username?; rememberSecret; secret?; headers; }
interface AuthSettings  { enabled; requireLogin; tenantId; clientId; redirectUri; }
```

**Distinctions conceptuelles à préserver** :

- **Tâche** ≠ **action de COPIL**. Une tâche est une unité de travail planifiable sur une
  demi-journée. Une action de COPIL est un **engagement pris devant les parties prenantes**,
  suivi d'une séance à l'autre. Les fusionner polluerait le planning et rendrait le relevé de
  décisions illisible.
- **FDR** = le *quoi* à l'échelle de l'année. **Planning** = le *qui fait quoi* à l'échelle de
  la semaine. **COPIL** = l'instance qui arbitre entre les deux.

### 4.3 Génération des identifiants (point critique)

`makeId(prefix)` = préfixe + horodatage base 36 + suffixe aléatoire
(`crypto.randomUUID` → `getRandomValues` → `Math.random` en repli).

> ⚠️ **Ne jamais utiliser un compteur en mémoire.** La première version utilisait
> `let idCounter = 1000`, remis à zéro à chaque chargement de page alors que les données sont
> persistées : deux enregistrements créés dans deux sessions différentes recevaient le **même
> identifiant**, et cocher une personne en cochait une autre. En client/serveur c'est pire
> encore : c'est le navigateur qui fixe l'identifiant enregistré par le serveur, donc deux
> collègues entraient en collision.
>
> Prévoir aussi `repairDuplicateIds()` : au chargement, les doublons éventuels sont détectés,
> le premier enregistrement garde son identifiant et les suivants en reçoivent un neuf. Les
> références vers un identifiant dupliqué sont **ambiguës par nature** : elles restent sur le
> premier enregistrement et un **bandeau visible** invite l'utilisateur à vérifier ses
> affectations (une réparation silencieuse laisserait des erreurs invisibles).

---

## 5. Les onglets

Ordre imposé dans la navigation, en trois groupes séparés visuellement :

**Quotidien** : Vue d'ensemble · Activité du jour · Planning · Tâches · Temps
**Pilotage** : Rapport · FDR · **COPIL** · *(COPIL est explicitement placé juste après FDR)*
**Administration** : Équipe · API · Paramètres

### 5.1 Vue d'ensemble

**Points d'attention** (en haut) — rassemble ce qui exigerait sinon de visiter plusieurs
onglets :

| Signal | Ton |
|---|---|
| Incidents critiques/hauts encore ouverts | Danger |
| Tâches en retard | Danger |
| Projets en flash report **Rouge** | Danger |
| **Actions de COPIL en retard** | Danger |
| Personnes en surcharge cette semaine | Attention |
| Projets en flash report **Orange** | Attention |
| Initiatives FDR non démarrées alors que leur trimestre est atteint | Attention |
| **COPIL à moins de 7 jours avec ordre du jour vide** | Attention |

**Chaque ligne se déplie sur place** pour afficher les éléments concernés (titre, statut,
priorité, assignés, échéance, heures planifiées vs disponibles, raisons du RAG…) — sans
changer d'onglet. Un bouton « Ouvrir → » mène quand même à l'onglet d'origine pour agir. Rien
à signaler ⇒ message vert, pas un bloc vide. À l'impression, tous les détails sont dépliés.

Ensuite : 4 indicateurs (incidents ouverts, tâches en retard, charge moyenne, présents
aujourd'hui) et la répartition de charge.

**3 modes** : **Complet** (défaut : charge détaillée + une fiche par personne) /
**Compact** (un tableau dense, une ligne par personne) / **Charge 3 semaines** (heures
planifiées vs capacité disponible, par personne et par semaine — pour voir venir une
surcharge).

### 5.2 Activité du jour

Ce que fait chaque personne ce matin / cet après-midi ; affectation d'une tâche au créneau,
changement de statut, saisie du temps passé. Navigation jour précédent / aujourd'hui / suivant.

**3 modes** : **Par personne** (défaut) / **Par créneau** (toute l'équipe côte à côte, matin
d'un côté, après-midi de l'autre) / **Tableau** (une ligne par personne, une colonne par
créneau, + temps saisi).
Les trois modes partagent le même composant d'édition de créneau : **tous restent modifiables**.

### 5.3 Planning 3 semaines

Aperçu compact des 3 semaines (mini-calendrier par personne) + semaine sélectionnée en
détail sous forme de calendrier (une carte par créneau, icône + titre, code couleur
MCO 🔧 / Incident 🔥 / Projet 📁). Gestion des absences, week-end teinté.
Un créneau ne propose que les tâches **éligibles** : matin ⇒ MCO/Incident, après-midi ⇒ Projet,
assignées à la personne et non terminées.

**3 modes** : **Grille hebdo** (défaut) / **Vue par personne** (3 semaines d'une seule
personne, titres complets) / **Liste chronologique** (agenda jour par jour de la semaine).

### 5.4 Tâches, incidents & projets

Liste filtrable (type, statut, assigné, recherche). Priorité, statut et assignés modifiables
directement dans le tableau ; « Modifier » ouvre un formulaire complet. Assignation
**multiple** (avatars empilés, menu à cocher).

**Flash report par projet** (regroupement par le champ `project`) — statut **RAG** calculé
selon des règles explicites, jamais estimé :

| Condition | Statut |
|---|---|
| ≥ 1 tâche en retard de priorité haute/critique | **Rouge** |
| ≥ 2 tâches en retard | **Rouge** |
| 1 tâche en retard | Orange |
| ≥ 1 tâche « en attente » (bloquée) | Orange |
| Dépassement > 150 % de la charge estimée sur une tâche | Orange |
| Aucun de ces signaux | Vert |

Le flash report contient : avancement, charge, réalisé sur 14 jours, échéances à 14 jours,
tâches en retard/bloquées, équipe. Export Markdown, PDF/impression, PowerPoint.

**3 modes** : **Tableau** (défaut) / **Kanban** (colonnes par statut, glisser-déposer pour
changer le statut — avec confirmation) / **Échéancier** (groupé par proximité d'échéance :
en retard, aujourd'hui, cette semaine, ce mois-ci, plus tard, sans échéance).

### 5.5 Temps

Récapitulatif hebdomadaire par personne vs cible 35 h, détail des saisies, export CSV.

### 5.6 Rapport hebdomadaire

À générer à la demande (pensé pour le vendredi). **Rien ne part automatiquement** : pas
d'envoi d'e-mail, pas de déclenchement programmé.

**Météo de la semaine** ☀️/🌤️/☁️/⛈️ — score calculé, facteurs **toujours affichés** :

| Facteur | Points |
|---|---|
| Charge moyenne > 100 % | +40 |
| Charge moyenne > 85 % | +25 |
| Charge moyenne > 50 % | +10 |
| Par incident critique/haut ouvert | +15 |
| Par tâche en retard | +8 |
| Par personne en surcharge | +10 |

Seuils : ≤ 15 ☀️ ensoleillé · ≤ 35 🌤️ éclaircies · ≤ 60 ☁️ nuageux · > 60 ⛈️ orageux.

Contient aussi : indicateurs clés, charge par personne, **état de la feuille de route**
(répartition par statut, initiatives en cours avec avancement, alerte sur celles dont le
trimestre est atteint sans démarrage), faits marquants, aperçu de la semaine suivante.
Exports : Markdown (presse-papiers), impression/PDF, **PowerPoint**.

**3 modes** : **Détaillé** (défaut) / **Résumé** (condensé sur un écran, les 3 points les plus
urgents par catégorie) / **Présentation** (grand format, pour projeter en réunion).

### 5.7 FDR — feuille de route

Vision stratégique **annuelle et pluriannuelle**, à distinguer du planning opérationnel.
Navigation par année (◀ ▶). Chaque initiative : domaine, trimestre (T1–T4 ou « Toute
l'année »), statut, priorité, porteurs, avancement %, budget prévisionnel optionnel, tâches
liées pour la traçabilité.

> L'avancement est **saisi à la main** : c'est l'estimation du pilote, pas un calcul
> automatique. Ne pas le déduire des tâches liées.

Filtres par domaine/statut/porteur, indicateurs (nombre par statut, budget cumulé), export CSV.

**3 modes** : **Trimestres** (défaut) / **Liste triable** (colonnes triables au clic) /
**Timeline annuelle** (une ligne par initiative sur l'axe T1→T4, les initiatives « année »
couvrant les 4 colonnes).

### 5.8 COPIL — comités de pilotage

Séances de gouvernance avec les parties prenantes. Chaque séance porte :
date/heure/lieu, statut (Planifié / Tenu / Annulé), participants internes **et externes**
(texte libre — ces personnes n'ont pas de fiche Équipe et **ne comptent pas dans la charge**),
**ordre du jour** (présentateur, durée, total affiché), **initiatives FDR passées en revue**,
**décisions actées**, **relevé d'actions** (responsables, échéance, statut), notes de séance,
date de la séance suivante.

Les sous-éléments (ordre du jour, décisions, actions) sont **imbriqués dans la séance**, pas
des collections séparées : une seule route serveur à sécuriser, et jamais d'action orpheline.

Exports : compte-rendu **Markdown**, impression/PDF, **PowerPoint** (le support qu'on projette).

**3 modes** : **Séances** (défaut — liste + détail ; **la prochaine séance à venir s'ouvre
d'office**, c'est celle qu'on prépare) / **Actions** (toutes les actions de toutes les
séances, filtrables par statut et responsable, **retards en tête**) / **Calendrier**
(chronologique, à venir puis passées, avec marqueur « ordre du jour à préparer »).

### 5.9 Équipe

Fiches membres éditables (rôle, compétences, volume horaire). Gestion des absences par
**plage de dates** (congés, formation, télétravail, astreinte) — la plage couvre tous les
jours, **week-end inclus**. Les absences réduisent la capacité disponible.

### 5.10 API

Console pour interroger des applications externes (ticketing, supervision) depuis le
navigateur : connexions réutilisables (URL de base, auth none/Bearer/clé API/Basic, en-têtes),
éditeur de requête, réponse formatée, historique des 30 derniers appels.
Les secrets ne sont mémorisés que si l'utilisateur coche explicitement « mémoriser ».

### 5.11 Paramètres

Authentification (SSO / comptes locaux / LDAP), statut HTTPS en direct, guide de déploiement,
**sauvegarde & historique des versions**, **mode de fonctionnement** (client/serveur ou autonome), **données conservées avant la bascule**.

---

## 6. Authentification

Trois méthodes, configurables dans Paramètres :

1. **SSO Microsoft Entra ID** — flux OAuth « client public » + PKCE via `@azure/msal-browser`.
   **Aucun secret d'application côté navigateur.** Seule méthode qui fonctionne **sans** le
   serveur (session gérée par le navigateur seul).
2. **Compte local** (identifiant + mot de passe) — **nécessite le serveur** : un navigateur ne
   peut pas vérifier un mot de passe en sécurité. Mots de passe hachés (`bcryptjs`).
3. **LDAP / Active Directory** — **nécessite le serveur** : vérification par « bind » direct
   auprès du contrôleur de domaine, **le mot de passe LDAP n'est jamais stocké**.

Session serveur : cookie **httpOnly** signé (JWT), commune aux trois méthodes — y compris le
SSO, dont le jeton est alors **vérifié côté serveur** avant d'ouvrir la session.

Interrupteur « Exiger la connexion ». **La page Paramètres reste accessible depuis l'écran de
connexion** pour éviter tout blocage en cas de mauvaise configuration.

> **Certificat SSL** : se configure sur IIS, **jamais dans l'application**. Un formulaire
> d'import de certificat exposerait des clés privées dans le navigateur — c'est un refus
> assumé et documenté, pas un oubli.

---

## 7. Mode client/serveur

L'application a **deux modes**, et le mode n'est jamais implicite : il est détecté au
démarrage, **mémorisé**, et affiché (point vert dans l'en-tête, carte dédiée dans Paramètres).

| | Autonome | Client / serveur |
| --- | --- | --- |
| Source de vérité | le navigateur (`localStorage`) | **le serveur** |
| Partage | non | oui, ~8 s |
| Connexion | selon l'interrupteur | **toujours obligatoire** |

**7 collections partagées** : `members`, `tasks`, `planningSlots`, `timeEntries`, `absences`,
`roadmapItems`, `copils`.
**Restent locales** : connexions/historique API (secrets personnels), historique de versions,
paramètres d'authentification.

### 7.1 Détermination du mode — `src/lib/serverMode.ts`

`/api/health` répond `{ ok, mode: 'client-serveur' }`. Le navigateur interroge cette sonde au
démarrage et **enregistre le résultat** (`localStorage: infra-team-tracker:mode`).

> **À ne surtout pas refaire** : la première version se contentait de tester si le serveur
> répondait *à cet instant*. À l'arrêt du service, chacun retombait silencieusement sur sa
> copie locale, continuait de travailler, et perdait tout au redémarrage. Le mode DOIT être
> mémorisé : un serveur injoignable est une **panne**, pas un changement d'architecture.

Trois états de liaison (`LinkState`) : `demarrage`, `connecte`, `indisponible`. Passage en
`indisponible` après **deux** sondages ratés consécutifs (un échec isolé ne doit pas sortir
l'utilisateur de son écran), ou dès le premier si rien n'a jamais été reçu.

### 7.2 Écrans qui précèdent l'application

Dans cet ordre : `Démarrage…` → `Serveur indisponible` (si mode serveur et liaison coupée) →
écran de connexion → `Chargement des données de l'équipe…` → `Mise en service du serveur`
(si jamais initialisé) → l'application.

- **Serveur indisponible** : l'application refuse d'afficher et de laisser saisir. Le sondage
  continue en arrière-plan et l'écran disparaît **de lui-même** au retour du serveur.
  Deux boutons : *Réessayer*, et *Travailler en mode autonome sur ce poste* (avec confirmation
  — c'est un changement de source de vérité, pas un réglage d'affichage).
- **Mise en service** : deux départs, une seule fois pour l'équipe — *serveur vide*, ou
  *reprendre les N enregistrement(s) de ce poste* (proposé uniquement si le poste a un usage
  autonome antérieur). Toute mise en service ultérieure est refusée (409).

### 7.3 Le serveur est la source de vérité — conséquences obligatoires

- **Aucune collection partagée en `localStorage`** en mode serveur (`partialize` les exclut,
  `merge` ignore celles déjà stockées). Sinon un rechargement réaffiche une copie périmée —
  y compris des enregistrements supprimés par l'équipe.
- **Collections vides au démarrage** en mode serveur (jamais le jeu d'exemple), et rien n'est
  affiché avant la première réponse : afficher des données de démonstration ferait croire à
  une équipe qui n'existe pas.
- **Une écriture refusée est annulée** : `syncWrite` signale franchement l'échec et appelle
  `requestResync()`, qui force une **relecture complète** (et non `?since=`, puisqu'un refus
  ne fait pas bouger la version du serveur — un sondage normal répondrait « rien de neuf » et
  laisserait la modification fantôme à l'écran).
- **Les enregistrements renvoyés par le serveur sont réappliqués** (`syncWriteRecord`) :
  `updatedAt`/`updatedBy` sont décidés côté serveur, et un horodatage inventé localement
  serait pris pour un conflit à la modification suivante.
- **Archive de bascule** (`src/lib/localArchive.ts`) : au passage autonome → serveur, les
  données du poste sont mises de côté sous une clé distincte, jamais détruites. Elles
  alimentent l'option « reprendre » et restent exportables (Paramètres). L'archivage se fait
  **au moment où le mode change**, pas dans `merge` : le mode n'est connu qu'après la réponse
  du serveur, donc après la réhydratation du store. Archiver depuis le stockage persisté (et
  non l'état courant) évite de proposer de « reprendre » le jeu d'exemple sur un poste neuf.

### 7.4 Concurrence

- **Sondage incrémental** : `GET /api/data?since=N` → `{ unchanged: true }` si la version
  serveur est inchangée. Sans cela, l'affichage était réécrit toutes les 8 secondes, y compris
  pendant une saisie.
- **Compteur `version`** incrémenté à chaque écriture, dans `business-meta.json`. Suppose un
  **seul processus** Node (cas prévu).
- **Détection de conflit** sur tâches / FDR / COPIL : le client envoie l'en-tête
  `X-Base-Updated-At` ; si la valeur a changé, le serveur **refuse** (409) au lieu d'écraser.
  Les collections à valeur unique (planning, temps, absences, membres) restent en « dernière
  écriture gagne » : leur écrasement ne détruit pas de texte rédigé.
- **Sondage 8 s, pas de WebSocket/SSE** : choix délibéré pour la robustesse derrière IIS/ARR,
  où les connexions longues sont une source connue de pannes.
- **Le navigateur génère l'identifiant**, le serveur l'accepte (`idOrNext`).

### 7.5 Robustesse du stockage serveur

- **Écriture atomique** : fichier temporaire dans le même dossier → `fsync` → `rename`. Un
  `writeFileSync` direct laisse une collection tronquée en cas de coupure.
- **Refus de démarrer sur fichier illisible**, avec le nom du fichier et la marche à suivre.
  Repartir d'une valeur par défaut donnerait un service qui *a l'air* de fonctionner pendant
  que l'équipe travaille par-dessus le vide.
- **Suppressions en cascade** identiques côté client et serveur : supprimer un membre le
  retire des `assigneeIds`, des créneaux, des porteurs FDR, des participants/porteurs/
  présentateurs COPIL ; supprimer une tâche la délie des créneaux et des FDR ; supprimer une
  initiative FDR la délie des COPIL.

---

## 8. Sauvegarde et versionnement

Deux mécanismes complémentaires :

1. **Historique automatique** — un point de restauration après chaque modification
   (regroupées avec un délai de 800 ms), jusqu'à **30 points** ou 4 Mo, dans le `localStorage`.
   Restaurer conserve d'abord l'état actuel : **une restauration s'annule elle aussi**.
2. **Sauvegarde manuelle `.json`** — export/import de fichier. **Seule méthode qui survit** à
   un vidage du stockage local ou à un changement de poste.

**En mode client/serveur, ces deux mécanismes sont désactivés** — et c'est délibéré :
l'historique automatique ne ferait que recopier dans le navigateur des données dont il n'est
pas responsable, et une restauration locale ne changerait rien côté serveur avant d'être
effacée au sondage suivant. Elle *aurait l'air* d'avoir fonctionné, ce qui est précisément ce
qu'on s'interdit. L'export manuel, lui, reste disponible dans les deux modes : c'est une
extraction sans effet de bord.

La sauvegarde du mode client/serveur se fait côté serveur, sur
`server/data/business-*.json` — c'est la seule copie du travail de l'équipe. Elle est fournie
sous forme de tâche planifiée Windows (`packaging/scripts/Backup-SuiviInfra.ps1` +
`Register-SuiviInfraBackup.ps1`), avec quatre exigences qu'une simple copie ne satisfait pas :

1. **Cohérence** : le compteur `version` est relevé avant et après la copie ; s'il a bougé,
   la copie recommence (jusqu'à 3 fois). Sans cela, un instantané peut mélanger des fichiers
   d'avant et d'après une écriture.
2. **Vérification** : chaque fichier copié est relu et analysé. Une sauvegarde illisible est
   inutile — le service refuse justement de démarrer dessus.
3. **Rotation après succès seulement**, et fondée sur le **nom** du dossier (`AAAA-MM-JJ_hhmm`)
   et non sa date de création, qui se perd si l'arborescence est déplacée.
4. **Code de sortie non nul en cas d'échec**, pour que le Planificateur de tâches le signale
   au lieu d'échouer en silence. Le script d'enregistrement exécute d'ailleurs la tâche une
   fois et vérifie le résultat : une tâche jamais exécutée n'est pas une sauvegarde.

Le `.env` (secret de session) est **exclu par défaut** : il partirait en clair sur le partage.
Restauration : arrêter le service, remettre les fichiers, redémarrer — la marche à suivre est
déposée dans chaque sauvegarde (`RESTAURATION.txt`).

Cas particulier — **données conservées avant la bascule** : un poste qui passe d'autonome à
client/serveur voit ses données mises de côté sous une clé distincte. Elles restent
téléchargeables depuis Paramètres, puis écartables explicitement (avec confirmation).

---

## 9. Exports

| Onglet | Exports |
|---|---|
| Tous | Impression / PDF |
| Temps | CSV |
| FDR | CSV |
| Tâches (flash report projet) | Markdown, PDF, **PowerPoint** |
| Rapport hebdomadaire | Markdown, PDF, **PowerPoint** |
| COPIL | Markdown (compte-rendu), PDF, **PowerPoint** |

### Sécurité des exports PowerPoint (vérifiée, pas seulement documentée)

- **Génération 100 % locale** dans le navigateur (`pptxgenjs`, import dynamique) — aucune
  donnée envoyée à un serveur.
- **Aucune macro possible** : `pptxgenjs` ne produit que du `.pptx` (OOXML), jamais du
  `.pptm` — il n'existe aucun mécanisme pour y insérer du VBA.
- **Aucun objet OLE, aucune image, aucun lien externe** : uniquement texte et tableaux.
- **Texte échappé** : testé avec des titres contenant `<`, `>`, `&`, `"` — le fichier reste
  valide, le texte s'affiche littéralement.
- **Fichier revalidé** avec `python-pptx` (bibliothèque tierce indépendante).
- **Exception connue** : `pptxgenjs` dépend de `image-size`, dont deux failles de déni de
  service n'ont pas de correctif publié. Vérifié : ce module n'est **jamais chargé** dans un
  navigateur et l'application n'insère jamais d'image ⇒ risque réel nul. À réévaluer si un
  correctif sort.

---

## 10. Architecture technique

### 10.1 Pile

| Élément | Version |
|---|---|
| React + React DOM | 19 |
| TypeScript | 6 |
| Vite | 8 |
| Tailwind CSS | 4 (+ `@tailwindcss/vite`) |
| Zustand | 5 (avec middleware `persist`) |
| `@azure/msal-browser` | 5 |
| `pptxgenjs` | 4 |
| oxlint | 1 |

Backend (`server/`, Node.js 18+, ESM) : `express` 4, `bcryptjs`, `jsonwebtoken`, `jose`,
`ldapts`, `cookie-parser`, `cors`, `dotenv`, `express-rate-limit`.
**Toutes les dépendances serveur sont du JavaScript pur** — aucun binaire natif, ce qui rend
`node_modules` portable vers Windows sans compilateur.

### 10.2 Arborescence

```
src/
  App.tsx                     onglets, garde d'authentification, bandeaux
  main.tsx
  types.ts                    tout le modèle de données
  data/seed.ts                jeu de données de démonstration réaliste
  store/useStore.ts           store Zustand persisté + appels de synchronisation
  hooks/  useServerSync.ts    sondage 8 s        useViewMode.ts   préférence d'affichage
  auth/   msalClient.ts       backendAuth.ts
  lib/    date.ts  workload.ts  selectors.ts  ids.ts  repairIds.ts  backup.ts
          weeklyReport.ts  flashReport.ts  copil.ts  taskViews.ts
          syncState.ts  serverSync.ts
          pptxCommon.ts  weeklyReportPptx.ts  flashReportPptx.ts  copilPptx.ts
  components/  Dashboard  DailyView  PlanningView  TasksView  TimeTrackingView
               WeeklyReportView  RoadmapView  CopilView  TeamView  ApiConsoleView
               SettingsView  FlashReportModal  ConfirmProvider  ui.tsx
server/src/
  index.js  config.js  dataStore.js  businessData.js
  auth/  localAuth.js  ldapAuth.js  ssoAuth.js  session.js
  routes/  auth.js  data.js
packaging/
  build-package.sh  INSTALL.md  scripts/{Install,Test,Uninstall}-SuiviInfra.ps1
public/web.config             en-têtes de sécurité IIS
```

### 10.3 Points d'implémentation à ne pas rater

- `syncState.ts` est un **pub-sub sans dépendance à React** : le store Zustand (fonctions
  simples) doit pouvoir savoir si la synchronisation est active. Le pont vers React se fait
  par `useSyncExternalStore`.
- La **réparation des identifiants** doit être branchée sur `merge` du middleware `persist`,
  **pas** sur `onRehydrateStorage` : ce dernier s'exécute pendant la création du store, avant
  que la constante `useStore` ne soit initialisée — `useStore.setState` y échoue
  silencieusement.
- `applyServerSnapshot` est le **seul** endroit qui ne doit jamais déclencher de
  synchronisation en retour (c'est une donnée entrante).

### 10.4 Sécurité (vérifié dans le code)

- Aucun `dangerouslySetInnerHTML`, `innerHTML`, `eval` — tout passe par le rendu JSX de React.
- Aucun secret codé en dur ; le SSO n'utilise aucun secret d'application.
- Aucun script inline dans le HTML généré (`script-src 'self'` sans exception) ; pas de source
  maps publiées.
- En-têtes fournis par `public/web.config` : CSP, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy, HSTS. `style-src` autorise `'unsafe-inline'` (couleurs
  d'avatar et barres de charge en styles dynamiques) — choix assumé et documenté.
- Toutes les routes `/api/data` exigent une session valide (401 sinon).

---

## 11. Déploiement Windows Server 2022

**Il n'y a pas de `.exe`** : l'application est un site statique servi par IIS, le service est
du JavaScript exécuté par Node.js. Rien de compilé ne tourne sur le serveur.

`packaging/build-package.sh` produit une archive contenant : `site/` (application construite),
`service/` (backend **avec ses dépendances déjà installées**), 3 scripts PowerShell,
`INSTALL.md`, `SHA256SUMS.txt`. Le script **refuse de produire le paquet** s'il détecte un
binaire natif (`*.node`) ou un script d'installation dans les dépendances, ce qui casserait la
portabilité Windows.

**Deux scénarios** : A = site seul (SSO ou rien, données locales à chaque navigateur) ;
B = site + service (comptes locaux/LDAP + données partagées).

`Install-SuiviInfra.ps1` : vérifie **tous** les prérequis avant de modifier quoi que ce soit,
publie le site, crée le site IIS + liaison HTTPS 443, **retire la liaison HTTP**, ajoute la
règle de pare-feu ; en scénario B installe le service via NSSM, génère un `.env` avec secret
aléatoire, restreint les ACL du dossier de données, configure le relais `/api` (URL Rewrite +
ARR). **Réentrant** : relancer met à jour en préservant `data\`, `.env` et un `web.config`
personnalisé.
`Test-SuiviInfra.ps1` vérifie l'installation, dont le **refus des données sans session (401)**.
`Uninstall-SuiviInfra.ps1` conserve les données sauf `-RemoveData` + confirmation tapée.

Prérequis : nom DNS, certificat HTTPS dans *Ordinateur local → Personnel* ; scénario B en
plus : Node.js LTS, NSSM, modules IIS URL Rewrite + ARR.

---

## 12. Limites assumées

- **Sans le serveur**, le verrou de connexion est un **contrôle d'interface, pas une barrière
  de sécurité** : les données restent dans le navigateur et un accès technique au poste permet
  de les lire. Avec le serveur, la connexion devient une vraie barrière — mais le serveur
  protège l'accès à l'application, pas les données une fois qu'on y est.
- **Pas de sauvegarde automatique** des données d'équipe côté serveur.
- **Pas de haute disponibilité** : un seul serveur IIS et un seul service, suffisant pour 6
  personnes.
- **Pas de gestion de certificat dans l'application** (volontaire, voir §6).
- **Les parties IIS / certificat / pare-feu / NSSM des scripts PowerShell n'ont pas pu être
  testées en conditions réelles** depuis l'environnement de développement Linux : syntaxe
  validée avec le parseur PowerShell 7.4 et parties exécutables testées, mais un premier
  passage sur une VM de test reste recommandé.
- **Avancement FDR saisi à la main**, jamais déduit des tâches liées.

---

## 13. Défauts rencontrés — à ne pas reproduire

| Défaut | Cause | Correctif |
|---|---|---|
| Cocher un utilisateur en cochait un autre | Compteur d'identifiants en mémoire remis à zéro à chaque chargement ⇒ identifiants dupliqués | `makeId()` horodatage + aléatoire, plus `repairDuplicateIds()` au chargement + bandeau |
| Activer le multi-utilisateur effaçait les données locales | Le sondage appliquait un instantané serveur vide avant que l'utilisateur ait pu publier | Garde `if (snapshot.isEmpty) return;` |
| « La modification reste enregistrée dans ce navigateur » était **faux** | Écriture en « tire et oublie » : le sondage suivant écrasait la modification 8 s plus tard | Écriture serveur-d'abord + resynchronisation forcée + message honnête |
| Panne du serveur = repli silencieux en autonome | Le mode était redétecté à chaud à chaque chargement | Mode **mémorisé** ; écran « Serveur indisponible » ; lecture et saisie bloquées |
| `npx tsc --noEmit` ne vérifiait rien | `tsconfig.json` a `"files": []` + `references` : la commande sort à 0 sans rien compiler | Utiliser `tsc -b` |
| L'en-tête annonçait « 6 personnes » en dur | Valeur écrite en dur, visible dès qu'un serveur neuf est vide | Compteur réel issu du store |
| L'archivage à la bascule ne se déclenchait jamais | Il était fait dans `merge`, qui s'exécute AVANT que le mode soit connu | Archiver sur l'événement de changement de mode |
| Réparation d'identifiants sans effet | Branchée sur `onRehydrateStorage`, exécuté avant l'initialisation de `useStore` | Branchée sur `merge` |
| Impression vide sur certains modes | `print:hidden` posé sur le conteneur de contenu | Ne masquer que les éléments d'interface |
| Timers de bandeau jamais nettoyés | Fonction de nettoyage retournée depuis un écouteur pub-sub qui ignore les retours | Variable hissée dans le `useEffect` |
| Installeur PowerShell interrompu sur serveur neuf | Sous `StrictMode`, lire `.Id`/`.Status` sur un cmdlet ne retournant rien lève une exception | Tester l'objet avant la propriété |

---

## 14. Vérification attendue

Avant de déclarer une fonctionnalité terminée :

1. `npx tsc -b`, `npx oxlint src/`, `npm run build` — tous propres.
   **Attention** : `npx tsc --noEmit` ne vérifie RIEN dans ce projet. `tsconfig.json` a
   `"files": []` et ne fait que référencer `tsconfig.app.json` / `tsconfig.node.json` : la
   commande sort à 0 sans avoir compilé une seule ligne. Utilisez `tsc -b` (ce que fait
   `npm run build`).
2. **Test dans un vrai navigateur** de chaque fonctionnalité (les captures d'écran ont servi
   de preuve tout au long du développement).
3. Pour les écritures : vérifier que la confirmation apparaît, que **Confirmer** applique et
   **persiste**, et que **Annuler** laisse la donnée **strictement inchangée**.
4. Pour le mode client/serveur, quatre scénarios à vérifier en navigateur, pas seulement le
   cas nominal :
   - **nominal** : deux navigateurs simultanés, propagation dans les deux sens ;
   - **écriture refusée** (forcer une erreur serveur) : message honnête + la modification
     disparaît de l'écran ;
   - **serveur arrêté** : écran d'indisponibilité, aucun basculement silencieux en autonome,
     retour automatique à la reprise du service ;
   - **migration** : un poste autonome avec des données, serveur démarré ensuite → l'option
     « reprendre les N enregistrements » est proposée et fonctionne.
5. Le mode autonome doit rester intact : sans serveur et sans historique, l'application démarre
   sur le jeu d'exemple et persiste en `localStorage`.
6. `npm audit` avant chaque build.
7. Nettoyer tous les artefacts de test avant livraison (scripts, dépendances temporaires,
   données de test, processus).

---

*Fin du cahier des charges — Suivi Infra & Réseau 1.1.0.*
