# NetSchema — serveur

Service qui diffuse l'application NetSchema et héberge les schémas partagés : **une
authentification, des rôles, des schémas communs, un journal d'audit**. Un seul processus,
un seul port, un seul dossier de données — c'est ce qui rend l'installation tenable sur un
serveur Windows d'entreprise.

L'application, elle, n'a pas changé : ouverte sans serveur, elle continue de fonctionner
seule avec le stockage du navigateur. Elle détecte le mode au démarrage, en une requête.

## Installer sur un serveur Windows

Un paquet prêt à installer, un double-clic :

```bash
node tools/creer-paquet.mjs      # produit paquet/NetSchema-<version>-windows.zip (~1,5 Mo)
```

Sur le serveur : extraire, **clic droit sur `1-Installer.cmd` → Exécuter en tant
qu'administrateur**. L'installeur vérifie Node.js (et l'installe au besoin), pose
l'application, déclare le service, ouvre le pare-feu, crée le premier administrateur, démarre
et vérifie que la page répond. Le certificat s'ajoute ensuite avec `2-Activer-HTTPS.cmd`.

Voir [`INSTALLATION-RAPIDE.md`](INSTALLATION-RAPIDE.md), et
[`DEPLOIEMENT-WINDOWS.md`](DEPLOIEMENT-WINDOWS.md) pour tout le reste (IIS, sauvegarde,
exploitation).

## En deux minutes (poste de développement)

```bash
cd apps/netschema && npm install && npm run build   # interface web
cd ../netschema-server && npm install && npm run build
npm run user -- add moi --role admin                # premier compte (mot de passe masqué)
npm start                                           # http://localhost:8080
```

## Ce que fait le serveur

| | |
| --- | --- |
| **Diffusion** | Sert l'application compilée (`apps/netschema/dist`), cache long pour les fichiers empreintés, jamais pour `index.html` |
| **Authentification** | Comptes locaux, mot de passe scrypt, session par cookie signé, jeton anti-CSRF |
| **Rôles** | `lecteur` (consultation), `editeur` (modification), `admin` (comptes et suppression) |
| **Schémas** | Un fichier JSON par schéma, écriture atomique, numéro de version contre les écrasements |
| **Audit** | Une ligne JSON par connexion, refus, création, modification, suppression |

## Sécurité — ce qui est en place

- **Mots de passe** : scrypt (N=16384, r=8, p=1), sel par compte, comparaison à temps
  constant. Paramètres inscrits dans l'empreinte, donc durcissables plus tard sans tout
  invalider. Aucune dépendance native à compiler sur le serveur.
- **Certificat** : PFX du magasin Windows lu tel quel (ou PEM), sans conversion ni OpenSSL.
- **Sessions** : cookie `HttpOnly`, `SameSite=Strict`, `Secure` en HTTPS, signé HMAC-SHA256,
  expiration incluse dans la signature. Aucun état en mémoire : redémarrer le service ne
  déconnecte personne. Chaque cookie porte la **génération de session** du compte : changer un
  mot de passe ou désactiver un compte l'incrémente, et tout ce qui a été émis avant cesse
  aussitôt d'être accepté — sans attendre l'expiration.
- **CSRF** : double soumission — un cookie lisible par l'application, répété dans l'en-tête
  `X-CSRF-Token`, exigé sur toute écriture.
- **Force brute** : 10 tentatives par quart d'heure et par adresse, puis blocage temporaire
  du compte après 10 échecs consécutifs. Un compte inconnu et un mot de passe faux donnent
  le même message et le même temps de réponse.
- **En-têtes** : CSP stricte (`default-src 'self'`, `frame-ancestors 'none'`, pas de script
  en ligne), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, HSTS en
  HTTPS, `X-Powered-By` retiré, `Permissions-Policy` n'autorisant que le microphone (la dictée)
  et refusant caméra, position, capteurs et paiement, `X-Permitted-Cross-Domain-Policies: none`.
- **Connexions** : délais de garde sur les en-têtes (20 s), la requête (60 s) et le
  maintien en vie (15 s), contre les connexions ouvertes au compte-gouttes.
- **Entrées** : corps limité à 8 Mo, JSON nettoyé en profondeur (clés `__proto__`,
  `constructor`, `prototype` écartées), nombre d'équipements et de liaisons borné,
  identifiants de schéma restreints à `[A-Za-z0-9_-]` **et** vérifiés comme restant dans le
  dossier prévu.
- **Écritures** : fichier temporaire puis renommage — une coupure ne laisse jamais un schéma
  à moitié écrit. Contrôle de version : deux personnes sur le même schéma ne s'écrasent pas
  en silence, la seconde reçoit un conflit.

- **Corps malformé** : un JSON illisible ou trop gros reçoit un 400 ou un 413, jamais une pile
  d'exception.

Ce qui **n'est pas** couvert et relève de l'installation : chiffrement du disque, sauvegarde du
dossier de données, annuaire d'entreprise (les comptes sont locaux), et le certificat TLS.

Deux points à connaître, plutôt que de les découvrir :

- **La dictée passe par le navigateur.** La reconnaissance vocale de Chrome et d'Edge envoie
  l'audio aux services de l'éditeur du navigateur ; l'application ne le fait pas elle-même et
  n'y a pas accès. Le champ de saisie du panneau vocal permet de s'en passer entièrement, et le
  microphone reste une permission que le navigateur demande site par site.
- **Le journal d'audit grossit sans limite.** Une ligne par connexion et par enregistrement :
  quelques mégaoctets par an pour une équipe, mais il n'y a pas de rotation automatique. À
  archiver avec le reste du dossier de données.

## Comptes

```bash
npm run user -- add rnelson --role admin      # mot de passe demandé, saisie masquée
npm run user -- passwd rnelson                # réinitialisation
npm run user -- role rnelson editeur
npm run user -- disable rnelson               # départ : on désactive, on ne supprime pas
npm run user -- list
```

Le mot de passe doit faire au moins 12 caractères et mêler trois catégories parmi
minuscules, majuscules, chiffres et symboles. Sans `--password`, il est demandé de façon
masquée : il n'apparaît alors ni à l'écran ni dans l'historique du terminal.

Tant qu'aucun compte n'existe, la page de connexion affiche la commande à taper sur le
serveur — plutôt qu'un compte par défaut que personne ne pense à changer.

## Configuration

Tout passe par des variables d'environnement, décrites dans
[`deploy/windows/netschema.env.example`](deploy/windows/netschema.env.example) : écoute,
certificat, emplacements, durée de session, seuils de blocage, taille maximale.

## API

Toutes les routes sont préfixées par `/api`. Les écritures exigent l'en-tête `X-CSRF-Token`.

| Méthode | Route | Rôle | Effet |
| --- | --- | --- | --- |
| `GET` | `/health` | — | État du service |
| `GET` | `/session` | — | Mode, compte connecté, jeton CSRF |
| `POST` | `/login` | — | Ouvre une session |
| `POST` | `/logout` | — | Ferme la session |
| `POST` | `/password` | connecté | Change son propre mot de passe |
| `GET` | `/diagrams` | connecté | Liste des schémas |
| `POST` | `/diagrams` | éditeur | Crée un schéma |
| `GET` | `/diagrams/:id` | connecté | Contenu et version |
| `PUT` | `/diagrams/:id` | éditeur | Enregistre (409 si la version a changé) |
| `DELETE` | `/diagrams/:id` | admin | Supprime |
| `GET` | `/users` | admin | Liste des comptes |
| `POST` | `/users` | admin | Crée un compte |
| `PATCH` | `/users/:nom` | admin | Rôle, activation, mot de passe |
| `DELETE` | `/users/:nom` | admin | Supprime un compte |

## Données

```
data/
  users.json           comptes (empreintes de mots de passe, rôles)
  session-secret.key   secret de signature, généré au premier démarrage
  diagrams/*.json      un fichier par schéma
  audit.log            journal, une ligne JSON par événement
```

Sauvegarder NetSchema = copier ce dossier. Restaurer = le remettre en place.

## Tests

```bash
npm run build && npm test
```

Dix-neuf tests démarrent le vrai serveur sur un dossier jetable et parlent HTTP : session
absente, CSRF manquant (y compris un jeton venu d'une autre session), indistinction compte
inconnu / mot de passe faux, rôles, conflit de version, traversée de chemin, pollution de
prototype, en-têtes de sécurité et politique de permissions, corps JSON invalide, création d'un
compte en lecture seule et refus de toute écriture de sa part, fermeture immédiate des sessions
à la désactivation d'un compte ou au changement de son mot de passe, et impossibilité pour un
administrateur de se retirer ses propres droits.

## Déploiement Windows

- [`INSTALLATION-RAPIDE.md`](INSTALLATION-RAPIDE.md) — le paquet, l'installeur, le certificat.
- [`DEPLOIEMENT-WINDOWS.md`](DEPLOIEMENT-WINDOWS.md) — le mode opératoire complet : installation
  manuelle, configuration, HTTPS, IIS, exploitation, dépannage.
