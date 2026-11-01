#!/usr/bin/env bash
# Builds and runs Ride On on a physical device, always from up-to-date code.
#
#   apple/scripts/run-on-device.sh ["Device name"]   (default: $RIDEON_DEVICE, then Dan’s iPhone Duo)
#   apple/scripts/run-on-device.sh --preflight      (paths and build settings only)
#
# Refuses to build a checkout that's behind origin/main, so a stale branch or worktree can never
# end up on the phone. Builds through the Xcode app rather than xcodebuild: Xcode 27 keeps the
# Apple Account where xcodebuild and the Xcode MCP can't see it ("No Accounts"), so only the app
# can register a new device and refresh the provisioning profile. devicectl then installs and
# launches, since an Xcode run only "completes" once the app quits.
set -euo pipefail

device="${1:-${RIDEON_DEVICE:-Dan’s iPhone Duo}}"
repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
project="$repo/apple/app/RideOn.xcodeproj"
cd "$repo"

if [ "${1:-}" = --preflight ]; then
  xcodegen generate --spec "$repo/apple/app/project.yml" --quiet
  xcodebuild -project "$project" -scheme RideOn -destination 'generic/platform=iOS' \
    -showBuildSettings CODE_SIGNING_ALLOWED=NO > "${TMPDIR:-/tmp}/rideon-device-preflight.log"
  echo "Project and device build settings resolved: $project"
  echo "No signing, installation or upload was attempted."
  exit 0
fi

git fetch --quiet origin main
if [ "$(git branch --show-current)" = main ]; then
  git pull --quiet --ff-only origin main
fi
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "error: $(git branch --show-current) is behind origin/main. Switch to main or rebase first." >&2
  exit 1
fi

# Xcode reloads a project regenerated under it, and the reload cancels the build ("cancelled", or
# "Could not compute dependency graph"), so every copy is closed before generating. Every checkout's
# project is called RideOn.xcodeproj and Xcode's scripting looks documents up by name, so closing
# the other copies also stops ⌘R in a stale window.
if pgrep -xq Xcode; then
  osascript <<'APPLESCRIPT'
tell application "Xcode"
	repeat with ws in (workspace documents whose name is "RideOn.xcodeproj")
		-- Stopping is asynchronous: wait, or closing asks whether to stop.
		stop ws
		repeat 30 times
			try
				if completed of (last scheme action result of ws) then exit repeat
			on error
				exit repeat
			end try
			delay 1
		end repeat
	end repeat
	close (workspace documents whose name is "RideOn.xcodeproj") saving yes
end tell
APPLESCRIPT
fi

(cd apple/app && xcodegen generate --quiet)

echo "Building $(git rev-parse --short HEAD) for ${device}…"
result="$(osascript - "$project" "$device" <<'APPLESCRIPT'
on run argv
	set projectPath to item 1 of argv
	set deviceName to item 2 of argv
	tell application "Xcode"
		set ws to open projectPath
		repeat 120 times
			if loaded of ws then exit repeat
			delay 1
		end repeat
		set active scheme of ws to scheme "RideOn" of ws
		set active run destination of ws to (first run destination of ws whose name is deviceName)
		-- A project Xcode has only just opened can still fail a build with no compile errors
		-- ("cancelled", "error occurred", "Could not compute dependency graph"); the next one works.
		repeat 3 times
			set r to build ws
			repeat 900 times
				if completed of r then exit repeat
				delay 1
			end repeat
			set out to status of r as text
			set settling to out is not "succeeded"
			try
				repeat with e in build errors of r
					set out to out & linefeed & "error: " & (message of e)
					if message of e does not start with "Could not compute dependency graph" then set settling to false
				end repeat
			end try
			if not settling then exit repeat
			delay 2
		end repeat
		return out
	end tell
end run
APPLESCRIPT
)"
if [ "$(head -n 1 <<<"$result")" != succeeded ]; then
  echo "$result" >&2
  exit 1
fi

# Xcode's DerivedData folder for this project is the one whose info.plist points back at it.
app=""
for info in ~/Library/Developer/Xcode/DerivedData/RideOn-*/info.plist; do
  if [ "$(/usr/libexec/PlistBuddy -c 'Print WorkspacePath' "$info" 2>/dev/null)" = "$project" ]; then
    app="$(dirname "$info")/Build/Products/Debug-iphoneos/RideOn.app"
  fi
done
if [ ! -d "$app" ]; then
  echo "error: couldn't find the built RideOn.app for $project" >&2
  exit 1
fi

echo "Installing and launching…"
xcrun devicectl device install app --quiet --device "$device" "$app"
xcrun devicectl device process launch --quiet --terminate-existing --device "$device" com.danbarclay.rideon
echo "Running $(git rev-parse --short HEAD) on ${device}."
