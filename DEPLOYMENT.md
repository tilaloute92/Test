# Déploiement sur Windows Server 2022 (IIS)

L'application est un site **100 % statique** (HTML/CSS/JS générés par `npm run build`) :
aucun runtime Node.js, base de données ni service applicatif ne tourne sur le serveur de
production. IIS se contente de servir des fichiers. Ça réduit nettement la surface
d'attaque du serveur : pas de processus applicatif à patcher, juste IIS et l'OS.

Le build peut être fait sur n'importe quel poste (le vôtre, un serveur de build/CI) —
**pas besoin d'installer Node.js sur le serveur Windows 2022 lui-même**, sauf si vous
préférez y faire le build directement.

## Vue d'ensemble des étapes

1. Générer le build (`dist/`)
2. Installer le rôle IIS sur le serveur
3. Copier `dist/` sur le serveur
4. Créer le site IIS et le binding HTTPS avec un certificat
5. Forcer la redirection HTTP → HTTPS
6. Mettre à jour la configuration SSO (Entra ID) avec l'URL finale
7. Vérifier
8. Pare-feu et maintenance continue

---

## 1. Générer le build

Sur un poste avec Node.js 18+ :

```powershell
git clone https://github.com/tilaloute92/Test.git
cd Test
git checkout claude/team-activity-tracking-infra-969r4y
npm install
npm run build
```

Cela produit un dossier `dist/` contenant tous les fichiers à déployer (y compris
`web.config`, copié automatiquement — voir la section Sécurité plus bas). C'est **ce
dossier `dist/`, et uniquement lui**, qu'il faut copier sur le serveur — jamais le
dossier `node_modules` ni le code source.

## 2. Installer le rôle IIS sur le serveur

Sur le serveur Windows Server 2022, en PowerShell (administrateur) :

```powershell
Install-WindowsFeature -Name Web-Server -IncludeManagementTools
```

Ça installe IIS avec les fonctionnalités de base — suffisant pour ce site (aucun module
supplémentaire n'est nécessaire : pas d'ASP.NET, pas de CGI, pas de module de réécriture
d'URL requis, puisque l'application ne fait pas de routage par URL).

## 3. Copier les fichiers sur le serveur

Copiez le contenu du dossier `dist/` (généré à l'étape 1) vers un dossier sur le
serveur, par exemple :

```
C:\inetpub\suivi-infra\
```

(Évitez de réutiliser `C:\inetpub\wwwroot` du site par défaut — créez un dossier dédié.)

## 4. Créer le site IIS et le binding HTTPS

### 4.1 Obtenir un certificat

Deux cas :
- **Certificat interne** (recommandé pour un usage interne à l'entreprise) : demandez-en
  un à votre autorité de certification interne (AD CS) pour le nom d'hôte choisi (ex.
  `suivi-infra.monentreprise.local`), ou générez-le via `certlm.msc` (Certificats —
  ordinateur local) → *Personnel* → *Toutes les tâches* → *Demander un nouveau
  certificat*.
- **Certificat public** (si l'application doit être accessible depuis l'extérieur) :
  obtenez-en un auprès d'une autorité publique (Let's Encrypt, DigiCert, etc.).

Le certificat doit être installé dans le magasin **Ordinateur local → Personnel** du
serveur avant l'étape suivante.

### 4.2 Créer le site dans le Gestionnaire IIS

1. Ouvrez le **Gestionnaire des services Internet (IIS)**.
2. Clic droit sur *Sites* → *Ajouter un site*.
3. Nom du site : `Suivi Infra & Reseau`.
4. Chemin d'accès physique : `C:\inetpub\suivi-infra`.
5. Type de liaison : **https**, port `443`, sélectionnez le certificat importé à
   l'étape 4.1.
6. Nom d'hôte : le nom DNS choisi (ex. `suivi-infra.monentreprise.local`) — assurez-vous
   qu'une entrée DNS interne pointe vers l'IP du serveur.
7. Validez.

## 5. Forcer la redirection HTTP → HTTPS

Par défaut, IIS crée aussi une écoute HTTP (port 80). Pour éviter que l'application ne
soit accessible en clair :

- Soit supprimez la liaison HTTP du site (*Liaisons* → sélectionnez `http` → *Supprimer*),
  si personne n'a besoin d'y accéder autrement qu'en HTTPS.
- Soit installez le module **URL Rewrite** (téléchargeable depuis le site IIS.net) et
  ajoutez une règle de redirection HTTP → HTTPS si vous préférez rediriger plutôt que
  couper l'accès HTTP.

La suppression de la liaison HTTP est l'option la plus simple et suffisante ici.

> Les en-têtes de sécurité (CSP, anti-clickjacking, HSTS, etc.) sont déjà inclus dans le
> fichier `web.config` livré avec le build — rien à faire de plus pour les activer, IIS
> les applique automatiquement dès que le site est en ligne. Voir le contenu commenté de
> `public/web.config` dans le dépôt pour le détail de chaque en-tête et pourquoi il est
> présent.

## 6. Mettre à jour la configuration SSO

Une fois l'URL finale connue (ex. `https://suivi-infra.monentreprise.local`) :

1. Dans le [portail Azure](https://portal.azure.com) → *Microsoft Entra ID* →
   *Inscriptions d'applications* → votre application → *Authentification*, vérifiez que
   l'URI de redirection **Application monopage (SPA)** correspond exactement à cette URL
   (avec le `https://`, sans slash final superflu).
2. Dans l'application elle-même, onglet **Paramètres**, mettez à jour le champ *URI de
   redirection* avec la même valeur, et testez le bouton *Se connecter avec Microsoft*.

## 7. Vérifier

- Ouvrez `https://suivi-infra.monentreprise.local` depuis un poste du domaine : le
  cadenas doit s'afficher sans avertissement (l'autorité interne doit être déployée sur
  les postes via GPO si vous utilisez un certificat interne).
- Dans les outils de développement du navigateur (F12 → onglet *Réseau* → cliquez sur la
  requête principale → *En-têtes de réponse*), vérifiez la présence de
  `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`.
- Testez la connexion SSO et la navigation dans les différents onglets.

## 8. Pare-feu et maintenance continue

- Sur le pare-feu Windows du serveur, n'autorisez que le port **443** en entrée pour ce
  site (443/TCP) ; fermez le 80 si la liaison HTTP a été supprimée à l'étape 5.
- Gardez Windows Server et IIS à jour (Windows Update standard) — c'est ce qui protège
  réellement le serveur, l'application elle-même n'exécutant aucun code côté serveur.
- Si vous mettez à jour l'application plus tard (nouvelle version), il suffit de
  refaire `npm run build` et de remplacer le contenu de `C:\inetpub\suivi-infra` par le
  nouveau `dist/` (le fichier `web.config` sera régénéré automatiquement à chaque build).
- Pensez à relancer `npm audit` avant chaque nouveau build si vous mettez à jour les
  dépendances, pour repérer d'éventuelles vulnérabilités publiées entre-temps.

---

## Ce que ce déploiement ne couvre pas

- **Sauvegarde des données** : chaque utilisateur a ses données dans le stockage local
  de *son* navigateur (voir README). Il n'y a rien à sauvegarder côté serveur, mais rien
  n'est centralisé non plus — la perte du profil navigateur d'un utilisateur perd ses
  données locales (planning, saisies de temps...).
- **Haute disponibilité / répartition de charge** : un seul serveur IIS suffit pour un
  usage interne à une équipe de 6 personnes ; non traité ici.
- **LDAP sur Active Directory local** et **gestion de certificat dans l'application** :
  volontairement non implémentés, voir l'onglet Paramètres de l'application et le
  README pour l'explication.
