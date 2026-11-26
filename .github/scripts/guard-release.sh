#!/usr/bin/env bash
# Vérifie qu'une publication différée reste fidèle à la version figée.
#
# Usage : bash .github/scripts/guard-release.sh .github/workflows/publish-0-5-0.yml
#
# Échoue si la cible est introuvable, n'est pas sur la branche publiée, ne porte pas
# la version du tag, si le tag existe déjà, ou si du code livré a changé depuis la
# cible alors que la branche est restée sur la même version. Une branche passée à une
# version supérieure est normale entre deux publications : c'est alors un simple avis.
set -u

fichier="${1:?Indique le fichier de workflow à lire}"
tag=$(sed -n 's/^ *tag: *\(v[0-9][^ ]*\) *$/\1/p' "$fichier" | head -1)
cible=$(sed -n 's/^ *target: *\([0-9a-f]\{40\}\) *$/\1/p' "$fichier" | head -1)

fail() { echo "::error::$1"; exit 1; }

[ -n "$tag" ] || fail "Aucun tag lisible dans $fichier."
[ -n "$cible" ] || fail "Aucune cible lisible dans $fichier."
git cat-file -e "${cible}^{commit}" 2>/dev/null || fail "La cible $cible est introuvable dans le dépôt."
git merge-base --is-ancestor "$cible" HEAD || fail "La cible $cible n'est pas sur la branche publiée."

version_cible=$(git show "${cible}:package.json" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))")
[ "v${version_cible}" = "$tag" ] || fail "La cible $cible est en version $version_cible, pas $tag."

if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
  fail "Le tag $tag existe déjà : la release a probablement été publiée."
fi

ecart=$(git diff --name-only "$cible" HEAD -- . ':(exclude).github' ':(exclude)docs' ':(exclude)*.md')
if [ -n "$ecart" ]; then
  version_tete=$(node -p "require('./package.json').version")
  if [ "$version_tete" = "$version_cible" ]; then
    echo "::error::Du code a changé depuis la cible $cible alors que la version est toujours $version_tete :"
    git --no-pager diff --stat "$cible" HEAD -- . ':(exclude).github' ':(exclude)docs' ':(exclude)*.md'
    fail "Recule la cible sur le dernier commit livrable, ou publie une version supérieure."
  fi
  echo "::notice::La branche est en $version_tete, la cible en $version_cible : les changements plus récents partiront dans une version ultérieure."
fi

echo "Cible $cible validée pour $tag."
