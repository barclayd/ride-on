#!/bin/sh
# Safari runs every registered copy of the extension at once, each with its own background but one
# shared storage.local. Builds left in another DerivedData folder, a worktree, an archive or a
# -derivedDataPath scratch folder then fail the current build's writes (SQLITE_BUSY) and draw their
# own, older Journeys strip, so a fix looks like it never landed. This keeps one copy and
# unregisters the rest: the app given, or else the newest build that isn't an archive's.
# Usage: unregister-stale.sh [path/to/RideOn.app]
set -eu
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
appex=/Contents/PlugIns/RideOnExtension.appex
real() { (cd "$1" 2>/dev/null && pwd -P) || true; }

# Each line ends "<registered at>\t<path>"; newest first.
copies=$(pluginkit -m -A -D -v -i com.danbarclay.rideon.Extension |
  awk -F'\t' '/\.appex$/ { print $(NF-1) "\t" $NF }' | sort -r | cut -f2)

if [ $# -gt 0 ]; then
  keep=$(real "$1")
else
  newest=$(printf '%s\n' "$copies" | grep -v -e '/ArchiveIntermediates/' -e '\.xcarchive/' | head -n 1)
  [ -n "$newest" ] || newest=$(printf '%s\n' "$copies" | head -n 1)
  [ -n "$newest" ] || exit 0
  keep=$(real "${newest%"$appex"}")
fi
[ -n "$keep" ] || { echo "No app to keep at ${1:-$newest}" >&2; exit 1; }

printf '%s\n' "$copies" | while IFS= read -r copy; do
  [ -n "$copy" ] || continue
  app=${copy%"$appex"}
  [ "$(real "$app")" = "$keep" ] && continue
  pluginkit -r "$copy" 2>/dev/null || true
  "$lsregister" -u "$app" 2>/dev/null || true
  echo "Unregistered the Safari extension in $app"
done
echo "Safari runs Ride On from $keep"
