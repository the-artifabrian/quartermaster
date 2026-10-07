#!/bin/sh
# Archive the shell from this checkout and upload it to TestFlight.
#
# Builds expire 90 days after upload, so run this from master about every
# two months. Signing and the upload use the Apple ID signed in to Xcode;
# App Store Connect assigns the build number. Nothing in the project changes.
#
#   sh ios/upload-testflight.sh            # Release archive + upload
#   TEAM_ID=XXXXXXXXXX sh ios/upload-testflight.sh
set -eu

cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
TEAM_ID="${TEAM_ID:-$(/usr/libexec/PlistBuddy -c 'Print :teamID' ios/ExportOptions.plist)}"
OUT="${OUT:-$(mktemp -d)}"

echo "Archiving $(git rev-parse --short HEAD) to $OUT"
xcodebuild -project ios/Quartermaster/Quartermaster.xcodeproj -scheme Quartermaster \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUT/Quartermaster.xcarchive" -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" archive -quiet

echo "Uploading"
xcodebuild -exportArchive -archivePath "$OUT/Quartermaster.xcarchive" \
  -exportOptionsPlist ios/ExportOptions.plist -exportPath "$OUT/export" \
  -allowProvisioningUpdates -quiet

echo "Uploaded. It shows up in TestFlight after processing (a few minutes)."
