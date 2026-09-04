# Suivi Infra & Réseau

Application de suivi d'activité pour une équipe infrastructures systèmes & réseau (6 personnes), pensée pour un chef d'équipe qui veut voir en un coup d'œil qui travaille sur quoi, la charge de chacun et le planning prévisionnel sur 3 semaines.

## Fonctionnement métier

- Volume hebdomadaire cible de 35h par personne (modifiable individuellement dans l'onglet Équipe), journée coupée en deux : **matin = MCO & incidents**, **après-midi = projets**.
- Chaque demi-journée (3,5h) est un créneau qu'on affecte à une tâche, **du lundi au dimanche** — l'équipe travaillant aussi le week-end et en horaires décalés, samedi et dimanche sont des jours planifiables comme les autres (repérés par un léger fond ambré dans les grilles).
- La charge de chacun se compare à son propre volume hebdomadaire, pas au nombre de jours affichés à l'écran : ajouter le week-end à la grille ne gonfle donc la charge de personne. Si quelqu'un est planifié au-delà de son volume (ex. week-end en plus d'une semaine déjà pleine), le dépassement se voit directement : le niveau "Surchargé" (> 105%) devient atteignable, ce qui n'était pas le cas avant.

## Fonctionnalités

- **Vue d'ensemble** : en haut de page, un bloc **"Points d'attention"** regroupe en un seul endroit ce qui, sinon, demanderait de visiter plusieurs onglets — incidents critiques/hauts ouverts, tâches en retard, personnes en surcharge, projets en flash report Rouge/Orange, initiatives FDR pas démarrées alors que leur trimestre est atteint. Chaque ligne renvoie directement vers l'onglet concerné ; rien à signaler affiche un message vert plutôt qu'un bloc vide. Ensuite : charge de la semaine par personne (sous-chargé / équilibré / chargé / surchargé) pour repérer un déséquilibre et rééquilibrer la répartition, tâche en cours de chacun, indicateurs (incidents ouverts, tâches en retard, présence du jour).
- **Activité du jour** : ce que fait chaque personne ce matin / cet après-midi, changement de statut et saisie du temps passé en direct.
- **Planning 3 semaines** : aperçu compact des 3 semaines (mini-calendrier par personne) + vue détaillée de la semaine sélectionnée sous forme de calendrier (une carte par créneau, icône + titre de tâche, code couleur MCO / Incident / Projet), avec gestion des absences et navigation par onglets de semaine.
- **Tâches, incidents & projets** : liste filtrable/éditable (type, priorité, statut, charge estimée vs temps passé, échéance). Priorité, statut et assigné(s) se changent directement dans le tableau ; "Modifier" ouvre un formulaire complet pour changer le reste (titre, type, projet, charge estimée, échéance, description). Une tâche peut être assignée à **plusieurs personnes à la fois** (avatars empilés, menu à cocher) — utile pour un incident ou un projet traité à plusieurs ; chaque personne assignée le retrouve dans sa propre activité du jour et son propre planning. Pour chaque projet (regroupement par le champ "Projet" des tâches), un **flash report** à la demande : statut Rouge/Orange/Vert calculé selon des règles explicites (jamais une estimation à l'œil — les raisons du statut sont toujours affichées), avancement, charge, réalisé récemment, échéances à venir, tâches en retard/bloquées, équipe. Exportable en Markdown, PDF/impression ou PowerPoint.
- **Suivi du temps** : récapitulatif hebdomadaire par personne vs cible 35h, détail des saisies, export CSV.
- **Équipe** : fiches membres éditables (rôle, compétences, volume horaire), gestion des absences/indisponibilités par plage de dates (congés, formation, télétravail, astreinte) qui viennent réduire la capacité disponible.
- **Requêtes API** : console pour interroger des applications externes (ticketing, supervision...) depuis le navigateur — connexions réutilisables (URL de base, authentification none/Bearer/clé API/Basic, en-têtes par défaut), éditeur de requête (méthode, chemin, en-têtes, corps JSON), réponse formatée et historique des derniers appels.

- **FDR (feuille de route)** : vue stratégique par trimestre pour l'année en cours et les années suivantes, à distinguer du planning opérationnel (3 semaines). Chaque initiative a un domaine (Infrastructure, Réseau, Sécurité, Cloud, Poste de travail, Autre), un statut (Idée / Planifié / En cours / Terminé / Reporté / Abandonné), une priorité, un ou plusieurs porteurs, un avancement en %, un budget prévisionnel optionnel, et peut être reliée à des tâches "Projet" existantes pour la traçabilité (l'avancement reste saisi à la main, ce n'est pas un calcul automatique). Navigation par année (◀ ▶), tableau par trimestre (T1 à T4 + "Toute l'année"), filtres par domaine/statut/porteur, indicateurs (nombre par statut, budget cumulé de l'année si renseigné), export CSV.
- **Rapport hebdomadaire** : à générer le vendredi (ou n'importe quand) — météo de la semaine (☀️/🌤️/☁️/⛈️) calculée à partir de la charge moyenne, des incidents critiques encore ouverts, des tâches en retard et du nombre de personnes en surcharge (facteurs toujours affichés, jamais une boîte noire), indicateurs clés, charge par personne, **état de la feuille de route** (répartition par statut, initiatives "En cours" avec leur avancement, alerte pour celles dont le trimestre cible est atteint sans avoir démarré), faits marquants (incidents ouverts/résolus, tâches terminées/en retard), aperçu de la semaine suivante. Export en Markdown (presse-papiers, pour coller dans un e-mail/Teams), impression/PDF, ou **PowerPoint** (diapositive de titre, météo & indicateurs, charge par personne, faits marquants, feuille de route, semaine prochaine — pour une réunion sans repartir de captures d'écran).
- **Paramètres** : authentification (SSO Microsoft, comptes locaux, LDAP/Active Directory), statut HTTPS, guide de déploiement, et **sauvegarde & historique des versions** — un point de restauration est enregistré automatiquement après chaque modification (membres, tâches, planning, temps, absences, connexions API, paramètres de connexion), pour revenir en arrière rapidement en cas de mauvaise manipulation ; chaque restauration conserve d'abord l'état actuel dans l'historique, elle est donc elle-même annulable. En complément, "Télécharger une sauvegarde (.json)" / "Restaurer depuis un fichier" permet une sauvegarde manuelle qui, elle, survit à un vidage du stockage du navigateur ou à un changement de poste — voir la section dédiée ci-dessous.
- **Confirmation systématique** : toute suppression et toute modification d'une donnée existante (changement de statut/priorité/assigné, réaffectation dans le planning, édition d'un membre ou d'une connexion API, activation de la connexion obligatoire...) déclenche une demande de confirmation avant d'être appliquée. Annuler laisse la donnée strictement inchangée. La création de nouvelles données (nouvelle tâche, nouveau membre, nouvelle absence...) n'est pas concernée — elle passe déjà par un formulaire explicite avec un bouton dédié.
- **3 modes d'affichage sur Tâches, Planning, FDR et Rapport** : les mêmes données, présentées différemment selon ce qu'on cherche à voir — le sélecteur (en haut de chaque onglet) retient le choix de chaque personne (stockage local du navigateur, jamais partagé entre collègues).
  - **Tâches** : Tableau (liste filtrable, vue par défaut) / Kanban (colonnes par statut, glisser-déposer une carte pour changer son statut) / Échéancier (regroupé par proximité d'échéance : en retard, aujourd'hui, cette semaine, ce mois-ci...).
  - **Planning** : Grille hebdo (vue par défaut, grille compacte par personne et par jour) / Vue par personne (planning détaillé des 3 semaines, une personne à la fois, titres complets) / Liste chronologique (agenda jour par jour de la semaine sélectionnée, matin puis après-midi — pratique pour un point d'équipe).
  - **FDR** : Trimestres (tableau par trimestre, vue par défaut) / Liste triable (toutes les initiatives filtrées, colonnes triables en cliquant sur l'en-tête) / Timeline annuelle (une ligne par initiative positionnée sur l'axe T1→T4).
  - **Rapport hebdomadaire** : Détaillé (vue par défaut, toutes les sections) / Résumé (condensé sur un écran, les 3 points les plus urgents de chaque catégorie) / Présentation (grand format, pensé pour être projeté en réunion).

**Export & impression sur chaque onglet** : un bouton "Imprimer / PDF" (menu Imprimer du navigateur, choisir "Enregistrer en PDF" pour exporter en fichier) est disponible en haut de chaque onglet — les éléments d'interface (filtres, boutons d'action, formulaires) sont masqués à l'impression pour ne garder que le contenu, et le thème sombre est automatiquement désactivé le temps de l'impression pour rester lisible sur papier. En complément, l'onglet Temps propose un export CSV du détail des saisies, et l'onglet FDR un export CSV des initiatives de l'année affichée (pour un tableur). Le rapport hebdomadaire et les flash reports projet (onglet Tâches) proposent en plus un **export PowerPoint** — voir la section Sécurité pour le détail de ce qui a été vérifié avant de l'activer.

Le rapport hebdomadaire se génère à la demande, pas automatiquement : rien ne peut se déclencher tout seul le vendredi ni envoyer un e-mail à votre place — il faut ouvrir l'onglet Rapport et utiliser "Copier en Markdown" ou "Imprimer / Enregistrer en PDF" pour le partager.

Les données métier (tâches, planning, temps saisi...) sont stockées dans le navigateur (`localStorage`) de chaque utilisateur. Sans le serveur d'authentification, ou tant que personne ne s'est connecté avec une vraie session serveur, chacun a sa propre copie locale. **Avec** le serveur (`server/`) et une session serveur active, ces mêmes données deviennent partagées entre tous les membres de l'équipe — voir la section "Mode multi-utilisateur" ci-dessous. Les appels API de l'onglet Requêtes API sont exécutés directement par le navigateur : l'application distante doit autoriser le CORS depuis cette page, sinon la requête est bloquée. Par défaut les secrets d'authentification de cet onglet ne sont pas mémorisés (à ressaisir à chaque session) ; l'option "mémoriser" les enregistre en clair dans le stockage local du navigateur.

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

## Mode multi-utilisateur (données d'équipe partagées)

Par défaut, chaque personne a sa propre copie locale des données (voir plus haut). En déployant le serveur optionnel (`server/`, déjà utilisé pour l'authentification locale/LDAP/SSO — voir [`server/README.md`](./server/README.md)), les **tâches, membres, planning, temps saisi, absences et feuille de route (FDR)** deviennent partagés en temps quasi-réel entre tous les membres connectés :

- **Activation automatique** : dès qu'une personne ouvre une session vérifiée par le serveur (compte local, LDAP, ou SSO Entra ID dont le jeton a été validé côté serveur), un point vert apparaît à côté de son nom dans l'en-tête — "Mode multi-utilisateur actif". Le SSO utilisé sans le serveur (session gérée uniquement par le navigateur) n'active pas le partage, faute de session serveur à synchroniser : c'est une distinction volontaire, pas un oubli.
- **Synchronisation par sondage (polling), pas de flux temps réel** : le navigateur récupère l'état partagé toutes les ~8 secondes, plutôt que d'ouvrir une connexion permanente (WebSocket/SSE). Choix délibéré pour la robustesse derrière un reverse proxy IIS/ARR, où ce type de connexion longue durée est une source connue de coupures et de configuration délicate. Chaque modification (créer/éditer/supprimer une tâche, affecter un créneau, poser une absence...) part immédiatement vers le serveur dès qu'elle est faite localement — inutile d'attendre le prochain sondage pour que sa propre action soit prise en compte ; c'est la vue des **autres** utilisateurs qui se met à jour au sondage suivant.
- **Rien ne bloque en cas de coupure réseau** : une écriture qui échoue affiche un bandeau orange discret et se referme tout seul après quelques secondes, mais la modification reste appliquée localement — elle n'est jamais annulée automatiquement. Le prochain sondage réussi réconcilie l'état.
- **Traçabilité** : chaque tâche et chaque initiative FDR modifiée via le serveur affiche "Dernière modification par *Prénom Nom*, le *date*" dans son formulaire d'édition — utile en équipe pour savoir qui a touché quoi en dernier, sans avoir à demander.
- **Démarrage ("Publier")** : le serveur démarre vide. La première personne qui se connecte peut, depuis Paramètres → "Mode multi-utilisateur", publier les données actuellement dans son navigateur pour amorcer le jeu de données partagé (avec confirmation, comme toute action qui remplace des données existantes). Une fois le serveur non vide, le bouton disparaît pour tout le monde — impossible d'écraser accidentellement les données de l'équipe par une seconde publication ; le serveur refuse la requête (erreur 409) si on essaie.
- **Ce qui reste local, volontairement** : les connexions/historique de l'onglet Requêtes API (identifiants personnels de test), l'historique de versions et la configuration d'authentification ne sont pas synchronisés — ce sont des réglages ou des secrets propres à chaque poste, pas des données d'équipe.
- **Sans le serveur**, ou avant la première connexion avec une session serveur active, l'application continue de fonctionner exactement comme avant (données locales uniquement) : le mode multi-utilisateur est une amélioration, jamais une dépendance obligatoire au démarrage.

Détails d'architecture et de déploiement (routes API, fichiers `server/data/business-*.json`, sauvegarde côté serveur) : voir [`DEPLOYMENT.md`](./DEPLOYMENT.md#b6-mode-multi-utilisateur-données-déquipe-partagées).

## Sécurité

Vérifié dans le code (au dernier commit) :

- **Dépendances** : `npm audit` ne remonte aucune vulnérabilité connue, à une exception documentée près (voir juste en dessous). À relancer avant chaque nouveau build, ce n'est valable qu'à l'instant où c'est exécuté.
- **XSS** : aucun `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni équivalent dans le code — tout le contenu (y compris les réponses de l'onglet Requêtes API) passe par le rendu JSX habituel de React, qui échappe automatiquement le texte affiché.
- **Secrets** : aucun secret n'est codé en dur. Les jetons/API keys saisis dans l'onglet Requêtes API ne sont écrits dans le stockage local que si l'utilisateur coche explicitement "mémoriser" — sinon ils restent en mémoire le temps de la session. Le SSO Entra ID n'utilise ni ne stocke de secret d'application (flux "client public" + PKCE).
- **Build** : aucun script inline dans le HTML généré (`script-src 'self'` fonctionne sans exception), pas de source maps publiées.
- **En-têtes HTTP** : Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy et Strict-Transport-Security sont fournis via `public/web.config` (inclus automatiquement dans chaque `dist/`) — testés sans aucune violation CSP sur tous les onglets de l'application. Le détail et la justification de chaque règle sont commentés dans ce fichier.

### Export PowerPoint (rapport hebdomadaire, flash reports projet)

Le format PowerPoint (`.pptx`) est un vecteur connu de logiciels malveillants (macros VBA, objets OLE) — ce qui suit a été vérifié avant d'activer cette fonctionnalité, pas seulement documenté a posteriori :

- **Génération 100% locale** : le fichier est construit dans le navigateur (bibliothèque `pptxgenjs`, chargée à la demande — elle n'alourdit pas le chargement initial de l'application) et téléchargé directement. Aucune donnée n'est envoyée à un serveur pour produire le fichier.
- **Aucune macro possible** : `pptxgenjs` ne sait générer que le format standard `.pptx` (OOXML), jamais `.pptm` (PowerPoint macro-activé) — il n'existe tout simplement pas de mécanisme dans la bibliothèque pour y insérer du code VBA.
- **Aucun objet OLE, aucune image, aucun lien hypertexte externe** : le code de génération (`src/lib/pptxCommon.ts`, `weeklyReportPptx.ts`, `flashReportPptx.ts`) n'utilise que du texte et des tableaux mis en forme — vérifiable directement dans ces fichiers.
- **Texte échappé correctement** : testé avec des titres de tâches contenant `<`, `>`, `&`, `"` (ex. `Test <script>alert(1)</script> & "quotes"`) — le fichier généré reste un `.pptx` valide, le texte s'affiche tel quel dans PowerPoint, sans possibilité de casser la structure du document ou d'y injecter du contenu.
- **Fichier revalidé indépendamment** : chaque export a été relu avec `python-pptx` (bibliothèque tierce, indépendante de `pptxgenjs`) pour confirmer que le fichier produit est un document OOXML conforme, et pas seulement "accepté" par la bibliothèque qui l'a écrit.

Exception documentée (`npm audit`) : `pptxgenjs` dépend de `image-size`, dont deux failles de déni de service (boucle infinie sur des images ICNS/JXL/HEIF malformées) n'ont, à ce jour, aucun correctif publié par son mainteneur. Vérifié dans le code de `pptxgenjs` : ce module n'est en réalité jamais chargé côté navigateur (le chemin de code concerné ne s'exécute que côté Node.js, absent de cette application) — et l'application n'utilise de toute façon jamais de fonction d'insertion d'image dans les exports PowerPoint générés, donc aucune image n'est jamais analysée par ce code. Ce point sera réévalué si `image-size` publie un correctif.

Limites à connaître :

- **Sans le serveur d'authentification (`server/`), le verrou de connexion est un contrôle d'interface, pas une barrière de sécurité serveur.** Il masque l'application tant qu'on n'est pas connecté, mais les données restent dans le stockage local du navigateur : quelqu'un avec un accès physique/technique à l'appareil (outils de développement du navigateur) pourrait les consulter directement. **Avec** le serveur d'authentification, la connexion devient une vraie barrière (session vérifiée côté serveur à chaque appel, mots de passe locaux hachés, mots de passe LDAP jamais stockés) — mais les données métier de l'application (tâches, planning...) continuent, elles, de résider uniquement dans le navigateur de chaque utilisateur : le serveur ne protège l'accès à l'application, pas ces données une fois qu'on y est.
- **Sans mode multi-utilisateur actif** (pas de serveur, ou personne n'a encore ouvert de session serveur), aucune donnée métier n'est centralisée : chaque utilisateur a sa propre copie locale (planning, tâches, temps saisi), rien n'est partagé entre collègues ni sauvegardé côté serveur. **Avec** le mode multi-utilisateur (voir section dédiée ci-dessus), les données d'équipe (tâches, planning, temps, absences, FDR) résident aussi dans `server/data/business-*.json` sur le serveur — ce fichier n'est, à ce jour, pas sauvegardé automatiquement par l'application (voir [`DEPLOYMENT.md`](./DEPLOYMENT.md) pour la marche à suivre côté infrastructure). L'historique de versions (voir section dédiée ci-dessus) reste, lui, un filet de sécurité local au navigateur, pas une sauvegarde centralisée : pensez à exporter régulièrement un fichier de sauvegarde si vous voulez une copie qui survive à cet ordinateur ou à ce serveur.
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
