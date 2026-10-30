#!/bin/sh
# Builds the Android debug APK: web build -> Capacitor sync -> Gradle. Output: dist-apk/GeoIQ.apk
set -e
cd "$(dirname "$0")/.."
. "$HOME/android/env.sh"
npx vite build
npx cap sync android
(cd android && ./gradlew assembleDebug)
mkdir -p dist-apk
cp android/app/build/outputs/apk/debug/app-debug.apk dist-apk/GeoIQ.apk
echo "APK: $(pwd)/dist-apk/GeoIQ.apk"
