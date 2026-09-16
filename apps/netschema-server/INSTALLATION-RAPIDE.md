# NetSchema — installation en cinq minutes

Ce paquet contient tout : l'application déjà compilée, le serveur, ses dépendances et les
scripts d'installation. **Rien à compiler, rien à télécharger** — sauf Node.js si le serveur
ne l'a pas encore, et l'installeur s'en charge tout seul s'il a accès à Internet.

---

## 1. Copier le paquet sur le serveur

Copiez l'archive `NetSchema-…-windows.zip` sur le serveur, par exemple dans
`C:\Temp`, puis **clic droit → Extraire tout…**

> Si Windows affiche « Ce fichier provient d'un autre ordinateur », faites d'abord
> **clic droit sur le .zip → Propriétés → Débloquer**, puis extrayez. Les scripts lèvent
> aussi ce marquage eux-mêmes, mais autant partir sur de bonnes bases.

## 2. Lancer l'installation

Dans le dossier extrait, **clic droit sur `1-Installer.cmd` → Exécuter en tant
qu'administrateur**.

*(Un double-clic simple fonctionne aussi : le script demande lui-même l'élévation.)*

L'installeur déroule huit étapes et vous parle à chacune :

| | |
| --- | --- |
| 1 | Vérifie Node.js, et l'installe si nécessaire |
| 2 | Repère les fichiers de l'application |
| 3 | Les installe dans `C:\Apps\NetSchema` |
| 4 | Écrit la configuration |
| 5 | Déclare le service Windows (démarrage automatique) |
| 6 | Restreint les droits sur les données, ouvre le pare-feu |
| 7 | Démarre le service et **vérifie qu'il répond** |
| 8 | Vous demande l'identifiant et le mot de passe du premier administrateur |

**Une seule question vous est posée** : l'identifiant et le mot de passe de ce premier compte.
Le mot de passe doit faire au moins 12 caractères et mêler trois catégories parmi minuscules,
majuscules, chiffres et symboles. Il n'est jamais affiché ni écrit dans un journal.

À la fin, l'adresse à ouvrir s'affiche, par exemple :

```
    Adresse          http://winas:8080
```

## 3. Vérifier depuis un poste

Ouvrez cette adresse dans un navigateur : la page de connexion doit apparaître. Connectez-vous
avec le compte créé, cliquez sur **Schémas** pour en créer un, ajoutez un équipement — le
bandeau du haut affiche « Enregistré hh:mm » au bout de trois secondes.

C'est tout : le service redémarre désormais avec le serveur.

---

## 4. Ajouter le certificat (HTTPS)

Tant que cette étape n'est pas faite, la liaison est **en clair** : les mots de passe circulent
en clair sur le réseau. À faire dès que vous avez un certificat au nom du serveur.

**Clic droit sur `2-Activer-HTTPS.cmd` → Exécuter en tant qu'administrateur.**

Deux cas :

- **Vous avez un fichier `.pfx`** → le script demande son chemin puis son mot de passe.
- **Le certificat est déjà dans le magasin de l'ordinateur** → lancez plutôt, dans une console
  administrateur :

  ```powershell
  cd C:\Temp\NetSchema-1.0.0-windows
  .\Configurer-HTTPS.ps1 -Empreinte <empreinte-du-certificat>
  ```

  *(L'empreinte se lit dans `Get-ChildItem Cert:\LocalMachine\My`.)*

Le script installe le certificat, bascule le service en HTTPS sur le port 8443, protège les
fichiers, redémarre et vérifie. La nouvelle adresse s'affiche : `https://winas:8443`.

---

## En cas de problème

**Clic droit sur `3-Diagnostic.cmd` → Exécuter en tant qu'administrateur.** Il n'installe rien :
il écrit un rapport complet (version de Node, état du service, ports, journaux, configuration
sans les mots de passe) dans `C:\ProgramData\NetSchema\diagnostic-….txt`. C'est ce fichier
qu'il faut transmettre.

Les trois causes les plus fréquentes :

| Ce que vous voyez | Ce qu'il faut faire |
| --- | --- |
| « Ce script doit être lancé en administrateur » | Clic droit → *Exécuter en tant qu'administrateur* |
| « Node.js n'a pas pu être téléchargé » | Le serveur n'a pas Internet : installez Node.js LTS à la main depuis <https://nodejs.org>, puis relancez |
| « Le service ne répond pas encore » | Le port est déjà pris : relancez avec un autre port, `.\Installer-NetSchema.ps1 -Port 8081` |

L'installeur peut être relancé autant de fois que nécessaire : il répare l'installation sans
jamais toucher aux schémas, aux comptes ni à la configuration existante.

---

## Repères

| | |
| --- | --- |
| Application | `C:\Apps\NetSchema` |
| **Données (à sauvegarder)** | `C:\ProgramData\NetSchema\data` |
| Configuration | `C:\Apps\NetSchema\netschema.env` |
| Journaux d'installation | `C:\ProgramData\NetSchema\logs` |
| Service Windows | `NetSchema` — `Restart-Service NetSchema` |

Gestion des comptes, depuis le serveur :

```powershell
cd C:\Apps\NetSchema
$env:NETSCHEMA_DATA_DIR = 'C:\ProgramData\NetSchema\data'
node tools\netschema-user.mjs list
node tools\netschema-user.mjs add mdupont --role editeur
node tools\netschema-user.mjs passwd mdupont
```

Rôles : `lecteur` consulte, `editeur` modifie, `admin` gère les comptes.

Désinstallation : `.\Installer-NetSchema.ps1 -Desinstaller` — les données sont conservées.

Pour tout le reste (IIS, sauvegarde, mise à jour, journal d'audit), voir
[`DEPLOIEMENT-WINDOWS.md`](DEPLOIEMENT-WINDOWS.md).
