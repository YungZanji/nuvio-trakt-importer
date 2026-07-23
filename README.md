# Nuvio Trakt Importer

A private, browser-only tool for importing a standard Trakt export (.json) into Nuvio Sync without connecting a Trakt account.

## What it imports

- Trakt watchlist into the Nuvio Library
- Watched movies and episodes into Nuvio watched status
- Playback entries into Nuvio Continue Watching

Existing Nuvio data is read and merged before anything is written. The importer requires a pre-import backup and verifies imported records after upload.

## Metadata and artwork

The metadata path is intentionally simple:

1. **TMDB first** for posters, backgrounds, title metadata, and runtime.
2. **Cinemeta fallback** only when TMDB is unavailable or incomplete. Cinemeta can fill runtime and other metadata, but MetaHub artwork URLs are discarded.
3. **Manual runtime fallback** only when neither provider can resolve a runtime.

TMDB-only Trakt records are supported, and Continue Watching lookups for TV use the individual episode runtime when TMDB provides it.

The deployed GitHub Pages build reads the TMDB application token from the `TMDB_READ_ACCESS_TOKEN` GitHub Actions secret. The token identifies the application to TMDB; it is not a user credential. Because this is a static browser application, any token included in the deployed JavaScript should be treated as publicly inspectable and restricted to read-only TMDB API access.

## Privacy model

The application is a static HTML page. It has no application server, database, analytics, advertising, cookies, or browser storage.

| Data | Where it goes |
| --- | --- |
| Trakt ZIP contents | Read in memory by your browser only; never uploaded |
| Nuvio approval code and account token | Sent directly between your browser and Nuvio; held in memory until the tab closes |
| Existing and converted Nuvio records | Sent directly between your browser and Nuvio Sync |
| Public TMDB/IMDb IDs and TV episode coordinates | Sent directly from the browser to TMDB for metadata after explicit consent |
| Public IMDb IDs | Sent to Cinemeta only when the TMDB result is unavailable or incomplete |
| Site request metadata | GitHub Pages may receive ordinary hosting logs such as IP address and user agent |

The ZIP, Nuvio token, watch timestamps, ratings, playback percentages, and account data are never sent to TMDB or Cinemeta.

Google Sans Flex is bundled into the HTML. Loading the site does not contact Google Fonts. See [PRIVACY.md](PRIVACY.md) for the complete disclosure.

## Use the hosted app

After GitHub Pages is enabled, the app will be available at:

`https://yungzanji.github.io/nuvio-trakt-importer/`

Use a current version of Chrome, Edge, Firefox, or Safari. Large archives may be limited by available memory on mobile browsers.

## Run locally

```sh
npm ci
TMDB_READ_ACCESS_TOKEN="your-read-token" npm run build
npm test
npm run verify:bundle
```

The TMDB token is optional for local builds. Without it, the importer falls back to Cinemeta for runtime/metadata and will not save MetaHub artwork.

Open `index.html` or `Nuvio-Trakt-Importer.html` in a current browser. The build is self-contained, including the font and ZIP parser.

## Deploy

The GitHub Pages workflow builds from source, runs the tests, and deploys `_site/index.html`. In the repository settings, choose **GitHub Actions** as the Pages source.

For TMDB artwork, add a repository Actions secret named `TMDB_READ_ACCESS_TOKEN` containing a read-only TMDB API Read Access Token.

## Security controls

- Exact-hash Content Security Policy for the inline stylesheet and script
- Network connections restricted to Nuvio, TMDB, and the consent-gated Cinemeta fallback
- MetaHub artwork URLs are never written by the importer
- `no-referrer` policy
- No third-party runtime scripts, fonts, CDNs, analytics, service workers, or storage APIs
- Mandatory backup and post-import verification
- Public API key format regression test

## Nuvio limitations

Nuvio Sync does not currently expose compatible fields for Trakt personal ratings, social activity, or independent personal-list membership. Those records stay in the original Trakt ZIP and are not flattened into a different category.

## Project status

Built against `NuvioMedia/NuvioTV` commit `a4e0c71678dc8364a4bf2175e8fa96c641da41d9`.

This is an independent community project and is not affiliated with or endorsed by Nuvio, Trakt, or TMDB.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## License

The application code is available under the [MIT License](LICENSE). Google Sans Flex is distributed under the [SIL Open Font License 1.1](FONT-LICENSE.txt). Other bundled notices are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
