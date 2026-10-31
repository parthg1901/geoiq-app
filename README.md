# GeoIQ

Learn every country by shape, flag, location, capital, clues and real photos, and track your **GeoIQ**: an IQ-style geography score where 100 is average and 15 points is one standard deviation.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build && npm run preview   # production build (enables the offline service worker / installable PWA)
```

## Data

`src/data/countries.json` and `public/data/*` are generated:

```bash
node scripts/fetch-data.mjs   # Wikipedia extracts, pageviews, photos, World Bank population (cached in scripts/.cache)
node scripts/fetch-profiles.mjs  # Wikidata facts + Wikipedia sections for country profiles
node scripts/build-data.mjs   # country metadata, silhouettes, world map, photo index, flags
node scripts/build-profiles.mjs  # public/data/profiles/{ID}.json + src/data/stats.json
```

**Content packs** (`public/data/packs/`, contract in `src/lib/packs.ts`) and coats of arms:

```bash
node scripts/packs/build-regions.mjs && node scripts/packs/regions-images.mjs   # US/Indian/Canadian/… states & provinces
node scripts/packs/build-physical.mjs   # rivers, seas, landforms, peaks
node scripts/packs/build-history.mjs    # 1815–1960 world maps (historical-basemaps, GPL-3.0)
node scripts/fetch-arms.mjs && sh scripts/compress-arms.sh   # country coats of arms
```

Bump `VERSION` in `public/sw.js` after regenerating data so installed apps pick up the new files.

## How GeoIQ works

Each (country, skill) item has a difficulty from how well-known the country is (Wikipedia pageviews, population, area) plus skill-specific offsets. Answers update your ability with a 3-parameter logistic IRT model, which corrects for lucky guesses on multiple choice. The GeoIQ Test is a 24-question computerized adaptive test. See `src/lib/geoiq.ts`.

## Android app (Capacitor)

**Releases:** push a version tag and GitHub Actions builds a signed APK and publishes it as a GitHub Release (installed/updated on the phone via Obtainium):

```bash
git tag v1.0.1 && git push origin v1.0.1    # v1.2.3 -> versionName 1.2.3, versionCode 10203 (must keep increasing)
```

Signing secrets live in the repo's Actions secrets (`GEOIQ_KEYSTORE_B64`, `GEOIQ_KEYSTORE_PASSWORD`, `GEOIQ_KEY_ALIAS`, `GEOIQ_KEY_PASSWORD`). The keystore must never change, or installed apps can't update.

**Local build** (same release key, read from `~/android/geoiq-release.properties`):

```bash
npm run android    # web build -> cap sync -> Gradle; APK at dist-apk/GeoIQ.apk
```

Needs `~/android/env.sh` (JDK 21 + Android SDK in `~/android`). This build host is ARM64 and Google only ships an x86_64 `aapt2`, so `~/.gradle/gradle.properties` (machine-level, not in the repo) points `android.aapt2FromMavenOverride` at `~/android/aapt2`, a wrapper that runs it through a user-mode qemu unpacked in `~/android/x86`.

Native extras live in `src/lib/native.ts` (no-ops on the web): daily streak-reminder notifications (rescheduled for the next 7 days; today's is skipped once the streak is secured), haptics, dark status bar, Android back button (closes overlays first), and the native share sheet.
