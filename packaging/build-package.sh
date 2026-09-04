#!/usr/bin/env bash
#
# Fabrique le paquet de déploiement Windows Server 2022 à partir des sources.
#
# À lancer depuis la racine du dépôt, sur un poste de build (Linux, macOS ou Windows avec
# Git Bash/WSL) disposant de Node.js 18+ :
#
#     bash packaging/build-package.sh
#
# Produit : packaging/out/suivi-infra-reseau_<version>_win2022.zip
#
# Le paquet contient le site déjà construit et les dépendances du service déjà installées :
# le serveur Windows n'a donc besoin ni de compilateur, ni d'accès Internet, ni de Git.
# (Toutes les dépendances du service sont du JavaScript pur — aucun binaire natif à
# recompiler par plateforme, ce qui est ce qui rend ce pré-packaging possible ; le script
# le revérifie à chaque build et s'arrête si ce n'était plus le cas.)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version || '0.0.0'")"
STAMP="$(date -u +%Y%m%d)"
NAME="suivi-infra-reseau_${VERSION}_${STAMP}_win2022"
OUT="packaging/out"
STAGE="${OUT}/${NAME}"

echo "==> Nettoyage"
rm -rf "$STAGE" "${OUT}/${NAME}.zip"
mkdir -p "$STAGE"

echo "==> Build du site (frontend)"
npm run build

echo "==> Installation des dépendances du service (production uniquement)"
( cd server && npm install --omit=dev --no-audit --no-fund )

echo "==> Vérification de la portabilité Windows du service"
if find server/node_modules -name '*.node' | grep -q .; then
  echo "ERREUR : une dépendance du service contient un binaire natif (*.node)." >&2
  echo "         Le paquet ne serait pas portable vers Windows tel quel." >&2
  echo "         Retirez cette dépendance, ou installez-la sur le serveur cible" >&2
  echo "         (npm install --omit=dev) au lieu de la pré-packager." >&2
  exit 1
fi

echo "==> Assemblage du paquet"
# 1. Le site statique (Partie A) — c'est ce qui est publié par IIS.
mkdir -p "$STAGE/site"
cp -r dist/. "$STAGE/site/"

# 2. Le service d'authentification / multi-utilisateur (Partie B), dépendances incluses.
mkdir -p "$STAGE/service"
cp -r server/src "$STAGE/service/"
cp -r server/scripts "$STAGE/service/"
cp -r server/node_modules "$STAGE/service/"
cp server/package.json server/package-lock.json "$STAGE/service/"
cp server/.env.example "$STAGE/service/"
[ -f server/README.md ] && cp server/README.md "$STAGE/service/"
# Le dossier de données est créé vide : il accueillera comptes locaux et données d'équipe.
mkdir -p "$STAGE/service/data"

# 3. Scripts d'installation et documentation.
cp packaging/scripts/*.ps1 "$STAGE/"
cp packaging/INSTALL.md "$STAGE/"
cp DEPLOYMENT.md "$STAGE/DEPLOYMENT-reference.md"
cp README.md "$STAGE/README-application.md"

# 4. Empreinte du contenu, pour vérifier l'intégrité après transfert sur le serveur.
( cd "$STAGE" && find . -type f ! -name SHA256SUMS.txt -print0 \
    | sort -z | xargs -0 sha256sum > SHA256SUMS.txt )

echo "==> Compression"
( cd "$OUT" && zip -qr "${NAME}.zip" "$NAME" )
rm -rf "$STAGE"

echo
echo "Paquet prêt : ${OUT}/${NAME}.zip"
du -h "${OUT}/${NAME}.zip" | cut -f1 | sed 's/^/Taille : /'
