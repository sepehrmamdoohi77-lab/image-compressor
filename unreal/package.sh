#!/usr/bin/env bash
#
# Package the Unreal port into one distributable archive.
#
#   ./unreal/package.sh          ->  unreal/BreachlineUE-UE5.8.zip
#
# The archive is a snapshot of this directory (README, START-HERE, the project).
# There is nothing to build first: the .uproject compiles on the target machine.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="$here/BreachlineUE-UE5.8.zip"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

mkdir -p "$stage/BreachlineUE-UE5.8"
cp -r "$here/README.md" "$here/START-HERE.txt" "$here/build.bat" "$here/BreachlineUE" "$here/tools" "$stage/BreachlineUE-UE5.8/"

# Editor/build leftovers never belong in the archive.
find "$stage" -name '.DS_Store' -delete
find "$stage" -type d \( -name Binaries -o -name Intermediate -o -name Saved -o -name DerivedDataCache \) -prune -exec rm -rf {} +

rm -f "$out"
( cd "$stage" && zip -r -X -q "$out" BreachlineUE-UE5.8 )

echo "wrote $out"
echo "  files: $(unzip -l "$out" | tail -1 | awk '{print $2}')"
echo "  size:  $(du -h "$out" | cut -f1)"
