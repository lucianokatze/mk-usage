#!/bin/sh
# Prints a version's notes: what CHANGELOG.md holds under `## [<version>]`, up to the
# next version or the links at the foot, without the blank lines around it. Fails
# when there are none, so CI stops a version that was bumped without its notes.
#
#   scripts/release-notes.sh 0.3.0 [CHANGELOG.md]
set -eu

version=${1:?uso: scripts/release-notes.sh <versión> [CHANGELOG.md]}
file=${2:-CHANGELOG.md}

notes=$(awk -v head="## [$version]" '
  index($0, head) == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found && /^\[[^]]+\]: / { exit }
  found { print }
' "$file" | sed '/./,$!d')

if ! printf '%s' "$notes" | grep -q '[^[:space:]]'; then
  echo "$file no tiene notas para la versión $version: falta la sección «## [$version] - AAAA-MM-DD»." >&2
  exit 1
fi

printf '%s\n' "$notes"
