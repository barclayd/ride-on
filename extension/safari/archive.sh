#!/bin/sh
# Archives Ride On for Safari for iOS and macOS and uploads both to App Store Connect (TestFlight).
# Version = latest extension-v* tag, so Safari and Chrome releases match.
set -eu
cd "$(dirname "$0")"
version=$(git describe --tags --match 'extension-v*' --abbrev=0 | sed 's/^extension-v//')
build=$(date -u +%Y%m%d%H%M)
xcodegen generate
for platform in iOS macOS; do
  archive="build/RideOn-$platform.xcarchive"
  xcodebuild archive -project RideOn.xcodeproj -scheme RideOn \
    -destination "generic/platform=$platform" -archivePath "$archive" \
    -allowProvisioningUpdates MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$build"
  xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist ExportOptions.plist \
    -exportPath "build/$platform" -allowProvisioningUpdates
done
# The archives' copies register with Safari too; hand it back to the newest local build.
./unregister-stale.sh
echo "Uploaded Ride On $version ($build). It appears in TestFlight once processed."
