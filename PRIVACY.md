# Privacy

Last updated: July 23, 2026

## Summary

Nuvio Trakt Importer is a static, browser-only application. The project operator does not run an application server and does not receive, store, or process your Trakt archive, Nuvio access token, Nuvio library, viewing history, watchlist, Continue Watching data, or TMDB API credential.

## Processing in your browser

Your selected Trakt ZIP is read from the browser File API and parsed in memory. The ZIP is not submitted to GitHub, the project operator, Nuvio, TMDB, Cinemeta, or any other metadata service.

The application does not use cookies, `localStorage`, `sessionStorage`, IndexedDB, service workers, analytics, advertising, tracking pixels, telemetry, or crash-reporting services. Closing the tab clears the in-memory application state and Nuvio tokens.

The app may create downloads only after an action you request, such as the mandatory pre-import backup and final audit report.

## Your TMDB API Read Access Token

TMDB is optional but recommended for more reliable artwork. Each user supplies their own TMDB API Read Access Token directly in the page.

The application does not include an operator-owned TMDB token and does not send your token to the project operator, GitHub, Nuvio, or Cinemeta. When you start metadata resolution, the token is held in the current page's in-memory state and used only in the `Authorization` header of direct requests from your browser to `api.themoviedb.org`.

The token is cleared from the input field and in-memory application state as soon as that metadata lookup finishes, including when the lookup fails. Refreshing or closing the page also discards it.

The application sets the token field to `autocomplete="off"`, but browser extensions, password managers, malware, developer tools, or a compromised browser/device are outside the application's security boundary.

## Direct network requests

Your browser may connect only to these services:

| Service | Purpose | Data involved |
| --- | --- | --- |
| `api.nuvio.tv` | TV sign-in, reading existing Nuvio data, importing, and verification | Approval session, temporary access token, selected profile data, and converted records |
| `api-two.nuvioapp.space` | Nuvio fallback API if the primary origin is unavailable | The same Nuvio request data |
| `nuvio.tv` | The approval page that you open explicitly | The approval code contained in the Nuvio-generated URL |
| `api.themoviedb.org` | Recommended artwork, title metadata, and runtime lookup | Your own TMDB read token plus public TMDB/IMDb content identifiers and TV season/episode numbers, after explicit consent |
| `v3-cinemeta.strem.io` | Runtime/metadata fallback when TMDB is not used or is incomplete | Public IMDb content identifiers only, after explicit consent |

The application does not send your Trakt ZIP, Nuvio token, viewing timestamps, ratings, playback percentages, or Nuvio account data to TMDB or Cinemeta.

MetaHub artwork URLs are intentionally discarded and are not written into Nuvio by this importer.

## Why TMDB is recommended

Cinemeta commonly provides poster and background URLs hosted by MetaHub. Some users reported that MetaHub artwork did not load reliably in Nuvio on their devices or networks. Because the importer refuses to persist those URLs, Cinemeta-only mode can resolve runtime and other metadata while leaving some artwork blank.

Using your own TMDB credential lets the importer obtain TMDB-hosted poster and background paths without relying on MetaHub.

## Hosting logs

The static site is hosted by GitHub Pages. Like ordinary web hosts, GitHub may receive and retain request information such as IP address, time, requested URL, user agent, and referring information subject to GitHub's own privacy terms. The application sets a `no-referrer` policy, but the project operator cannot control GitHub's infrastructure logs.

GitHub does not receive the ZIP or TMDB token merely because the site is hosted on GitHub Pages. ZIP parsing and TMDB token entry happen after the page has loaded and remain within the browser except for the direct TMDB requests described above.

TMDB and Cinemeta may receive ordinary network information such as the user's IP address when the browser sends a metadata request. Those requests go directly from the user's browser to the metadata provider and are not routed through the project operator.

## Fonts and third-party assets

Google Sans Flex and the ZIP parser are included in the built HTML. The page does not request fonts, scripts, stylesheets, analytics, or tracking assets from Google or another CDN.

Poster and background URLs saved into Nuvio come from TMDB when available. The importer itself does not need to render those poster images during the migration.

## Local use

A locally built or downloaded copy follows the same application behavior. No operator TMDB credential is compiled into the HTML. A user who chooses TMDB supplies their own token at runtime, and it is handled exactly as described above.

## Data deletion

Because the project operator does not collect application data, there is no application database from which to request deletion. Close the tab to discard its in-memory state. Backups and audit files that you download remain on your device until you delete them.

## Changes

Material changes to this document will be visible in the public Git history.
