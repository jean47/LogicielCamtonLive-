#!/usr/bin/env bash
# Publie une release GitHub : tag sur la cible si besoin, puis fichiers joints.
set -euo pipefail

tag="${1:?tag manquant}"
target="${2:-}"
dossier="${3:-build}"

titre="Camton Live ${tag}"
case "$tag" in v0.*) titre="${titre} — bêta" ;; esac

if gh release view "$tag" >/dev/null 2>&1; then
  echo "La release ${tag} existe déjà : rien à publier."
  exit 0
fi

if [ -n "$target" ] && ! gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/${tag}" >/dev/null 2>&1; then
  echo "Création du tag ${tag} sur ${target}"
  gh api -X POST "repos/${GITHUB_REPOSITORY}/git/refs" \
    -f ref="refs/tags/${tag}" -f sha="${target}" >/dev/null
fi

mapfile -t fichiers < <(find "$dossier" -type f | sort)
if [ "${#fichiers[@]}" -eq 0 ]; then
  echo "::error::Aucun fichier à joindre dans ${dossier}"
  exit 1
fi

gh release create "$tag" "${fichiers[@]}" --title "$titre" --generate-notes
echo "Release ${tag} publiée avec ${#fichiers[@]} fichiers."
