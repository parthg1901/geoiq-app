#!/bin/sh
# Builds a signed release APK locally (same key as CI): web build -> Capacitor sync -> Gradle. Output: dist-apk/GeoIQ.apk
# Normal releases go through GitHub: git tag vX.Y.Z && git push origin vX.Y.Z
set -e
cd "$(dirname "$0")/.."
. "$HOME/android/env.sh"
npx vite build
npx cap sync android
(cd android && ./gradlew assembleRelease)
mkdir -p dist-apk
cp android/app/build/outputs/apk/release/app-release.apk dist-apk/GeoIQ.apk
echo "APK: $(pwd)/dist-apk/GeoIQ.apk"
