# Nuvio Trakt Importer

A private, browser-only tool for importing a standard Trakt export (.json) into Nuvio Sync without connecting a Trakt account.

## What it imports

- Trakt watchlist into the Nuvio Library
- Watched movies and episodes into Nuvio watched status
- Playback entries into Nuvio Continue Watching

Existing Nuvio data is read and merged before anything is written. The importer requires a pre-import backup and verifies imported records after upload.

## Metadata and artwork

The metadata path is intentionally simple:

1. **TMDB first, recommended** for posters, backgrounds, title metadata, and runtime. Each user supplies their own TMDB API Read Access Token in the page.
2. **Cinemeta fallback** when TMDB is not used or cannot resolve an item. Cinemeta can still provide runtime and other metadata, but MetaHub artwork URLs are discarded.
3. **Manual runtime fallback** only when neither provider can resolve a runtime.

TMDB-only Trakt records are supported, and Continue Watching lookups for TV use the individual episode runtime when TMDB provides it.

### Why TMDB is recommended

Cinemeta commonly returns artwork hosted by MetaHub. Some Nuvio users reported that those MetaHub poster URLs did not load reliably on their devices or networks. This importer therefore refuses to save MetaHub artwork into Nuvio. In Cinemeta-only mode, runtimes and metadata can still resolve, but some posters may be blank.

TMDB avoids that dependency by resolving poster and background paths through the user's own TMDB API access.

### Your TMDB credential

Use the **API Read Access Token** from your own TMDB account. TMDB documents this token as a Bearer token for application-level API requests.

The importer:

- never contains or uses the project operator's TMDB credential
- does not save your TMDB token in cookies, `localStorage`, `sessionStorage`, IndexedDB, a database, or a file
- keeps the token only in the current page while metadata is being resolved
- sends the token only to `api.themoviedb.org` in the request `Authorization` header
- clears the token from the page and in-memory application state as soon as the metadata lookup finishes

Closing or refreshing the page also discards it. The application cannot control browser extensions, password managers, malware, or a compromised browser/device, so only paste the token into a browser environment you trust.

TMDB authentication documentation: https://developer.themoviedb.org/docs/authentication-application

## Privacy model

The application is a static HTML page. It has no application server, database, analytics, advertising, cookies, or browser storage.

| Data | Where it goes |
| --- | --- |
| Trakt ZIP contents | Read in memory by your browser only; never uploaded |
| Nuvio approval code and account token | Sent directly between your browser and Nuvio; held in memory until the tab closes |
| Existing and converted Nuvio records | Sent directly between your browser and Nuvio Sync |
| Your TMDB API Read Access Token | Sent directly from your browser to TMDB only during metadata lookup; never sent to the project operator, GitHub, Nuvio, or Cinemeta |
| Public TMDB/IMDb IDs and TV episode coordinates | Sent directly from the browser to TMDB when you provide a TMDB token |
| Public IMDb IDs | Sent to Cinemeta when fallback metadata is needed |
| Site request metadata | GitHub Pages may receive ordinary hosting logs such as IP address and user agent |

The ZIP, Nuvio token, watch timestamps, ratings, playback percentages, and account data are never sent to TMDB or Cinemeta.

Google Sans Flex is bundled into the HTML. Loading the site does not contact Google Fonts. See [PRIVACY.md](PRIVACY.md) for the complete disclosure.

## Use the hosted app

After GitHub Pages is enabled, the app will be available at:

`https://yungzanji.github.io/nuvio-trakt-importer/`

Use a current version of Chrome, Edge, Firefox, or Safari. Large archives may be limited by available memory on mobile browsers.

For the best artwork reliability, paste your own TMDB API Read Access Token into Step 2. Leaving it blank uses Cinemeta-only fallback mode.

## Run locally

The local build uses the exact same privacy model as the hosted page. No TMDB credential is compiled into the app.

```sh
npm ci
npm run build
npm test
npm run verify:bundle
```

Then open `index.html` or `Nuvio-Trakt-Importer.html` in a current browser and paste your own TMDB read token into Step 2 when you want TMDB metadata.

A source ZIP downloaded from GitHub can be built the same way. The generated HTML is self-contained, including the font and ZIP parser; there is no application server to configure.

## Deploy

The GitHub Pages workflow builds from source, runs the tests, and deploys `_site/index.html`. In the repository settings, choose **GitHub Actions** as the Pages source.

No TMDB repository secret or operator-owned API key is required. Every user chooses whether to provide their own TMDB token at runtime.

## Security controls

- Exact-hash Content Security Policy for the inline stylesheet and script
- Network connections restricted to Nuvio, TMDB, and the consent-gated Cinemeta fallback
- User-supplied TMDB token held only during metadata lookup and then cleared
- MetaHub artwork URLs are never written by the importer
- `no-referrer` policy
- No third-party runtime scripts, fonts, CDNs, analytics, service workers, or storage APIs
- Mandatory backup and post-import verification
- Bundle tests verify that TMDB credentials are not embedded or stored by the application

## Nuvio limitations

Nuvio Sync does not currently expose compatible fields for Trakt personal ratings, social activity, or independent personal-list membership. Those records stay in the original Trakt ZIP and are not flattened into a different category.

## Project status

Built against `NuvioMedia/NuvioTV` commit `a4e0c71678dc8364a4bf2175e8fa96c641da41d9`.

This is an independent community project and is not affiliated with or endorsed by Nuvio, Trakt, or TMDB.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## License

The application code is available under the [MIT License](LICENSE). Google Sans Flex is distributed under the [SIL Open Font License 1.1](FONT-LICENSE.txt). Other bundled notices are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
