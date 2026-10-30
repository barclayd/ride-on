#!/usr/bin/env bash
# Builds and runs Ride On on a physical device, always from up-to-date code.
#
#   app/scripts/run-on-device.sh ["Device name"]   (default: $RIDEON_DEVICE, then Dan’s iPhone Duo)
#
# Refuses to build a checkout that's behind origin/main, so a stale branch or worktree can never
# end up on the phone. Builds through the Xcode app rather than xcodebuild: Xcode 27 keeps the
# Apple Account where xcodebuild and the Xcode MCP can't see it ("No Accounts"), so only the app
# can register a new device and refresh the provisioning profile. devicectl then installs and
# launches, since an Xcode run only "completes" once the app quits.
set -euo pipefail

device="${1:-${RIDEON_DEVICE:-Dan’s iPhone Duo}}"
repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
project="$repo/app/RideOn.xcodeproj"
cd "$repo"

git fetch --quiet origin main
if [ "$(git branch --show-current)" = main ]; then
  git pull --quiet --ff-only origin main
fi
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "error: $(git branch --show-current) is behind origin/main. Switch to main or rebase first." >&2
  exit 1
fi

(cd app && xcodegen generate --quiet)

echo "Building $(git rev-parse --short HEAD) for ${device}…"
# Every checkout's project is called RideOn.xcodeproj and Xcode's scripting looks documents up by
# name, so the other copies are closed first. That also stops ⌘R in a stale window.
result="$(osascript - "$project" "$device" <<'APPLESCRIPT'
on run argv
	set projectPath to item 1 of argv
	set deviceName to item 2 of argv
	tell application "Xcode"
		close (workspace documents whose name is "RideOn.xcodeproj" and path is not projectPath) saving yes
		set ws to open projectPath
		repeat 120 times
			if loaded of ws then exit repeat
			delay 1
		end repeat
		set active scheme of ws to scheme "RideOn" of ws
		set active run destination of ws to (first run destination of ws whose name is deviceName)
		-- Stopping an earlier run is asynchronous and cancels a build started before it lands.
		stop ws
		repeat 30 times
			try
				if completed of (last scheme action result of ws) then exit repeat
			on error
				exit repeat
			end try
			delay 1
		end repeat
		set r to build ws
		repeat 900 times
			if completed of r then exit repeat
			delay 1
		end repeat
		set out to status of r as text
		try
			repeat with e in build errors of r
				set out to out & linefeed & "error: " & (message of e)
			end repeat
		end try
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
