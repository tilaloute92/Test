#!/usr/bin/env bash
#
# Fabrique le paquet de déploiement Windows Server 2022 de Plan Relief.
#
# À lancer depuis n'importe où, sur un poste de build (Linux, macOS ou Windows avec
# Git Bash/WSL) disposant de Node.js 18+ :
#
#     bash plan-relief/packaging/build-package.sh
#
# Produit : plan-relief/packaging/out/plan-relief_<version>_<date>_win2022.zip
#
# Même principe que le paquet de Suivi Infra & Réseau : le site déjà construit et les
# dépendances du service déjà installées. Le serveur Windows n'a besoin ni de compilateur,
# ni d'accès Internet, ni de Git. (Toutes les dépendances du service sont du JavaScript pur ;
# le script le revérifie à chaque build et s'arrête si ce n'était plus le cas.)

set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"

VERSION="$(node -p "require('./package.json').version || '0.0.0'")"
STAMP="$(date -u +%Y%m%d)"
NAME="plan-relief_${VERSION}_${STAMP}_win2022"
OUT="packaging/out"
STAGE="${OUT}/${NAME}"

echo "==> Nettoyage"
rm -rf "$STAGE" "${OUT}/${NAME}.zip"
mkdir -p "$STAGE"

echo "==> Build du site (interface)"
npm ci --no-audit --no-fund
npm run build

echo "==> Tests du service"
( cd server && npm ci --no-audit --no-fund && npm test )

echo "==> Installation des dépendances du service (production uniquement)"
( cd server && rm -rf node_modules && npm ci --omit=dev --no-audit --no-fund )

echo "==> Vérification de la portabilité Windows du service"
if find server/node_modules -name '*.node' | grep -q .; then
  echo "ERREUR : une dépendance du service contient un binaire natif (*.node)." >&2
  echo "         Le paquet ne serait pas portable vers Windows tel quel." >&2
  exit 1
fi

echo "==> Vérification de l'encodage des scripts PowerShell"
# Windows PowerShell 5.1 (celui de Windows Server 2022) lit un script sans BOM en
# Windows-1252 : les accents deviennent d'autres caractères et le script ne s'analyse plus.
for f in packaging/scripts/*.ps1; do
  if [ "$(head -c3 "$f" | od -An -tx1 | tr -d ' ')" != "efbbbf" ]; then
    echo "ERREUR : $f doit être enregistré en UTF-8 avec BOM." >&2
    exit 1
  fi
done

echo "==> Assemblage du paquet"
# 1. Le site statique — publié par IIS.
mkdir -p "$STAGE/site"
cp -r dist/. "$STAGE/site/"

# 2. Le service (plans, recherche, authentification), dépendances incluses.
mkdir -p "$STAGE/service"
cp -r server/src server/scripts server/node_modules "$STAGE/service/"
cp server/package.json server/package-lock.json server/.env.example server/README.md "$STAGE/service/"
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

# Les dépendances de développement du service sont réinstallées pour la suite du travail.
( cd server && npm ci --no-audit --no-fund >/dev/null )

echo
echo "Paquet prêt : ${OUT}/${NAME}.zip"
du -h "${OUT}/${NAME}.zip" | cut -f1 | sed 's/^/Taille : /'
