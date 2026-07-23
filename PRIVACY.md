# Privacy

Last updated: July 23, 2026

## Summary

Nuvio Trakt Importer is a static, browser-only application. The project operator does not run an application server and does not receive, store, or process your Trakt archive, Nuvio access token, Nuvio library, viewing history, watchlist, or Continue Watching data.

## Processing in your browser

Your selected Trakt ZIP is read from the browser File API and parsed in memory. The ZIP is not submitted to GitHub, the project operator, Nuvio, TMDB, Cinemeta, or any other metadata service.

The application does not use cookies, `localStorage`, `sessionStorage`, IndexedDB, service workers, analytics, advertising, tracking pixels, telemetry, or crash-reporting services. Closing the tab clears the in-memory application state and Nuvio tokens.

The app may create downloads only after an action you request, such as the mandatory pre-import backup and final audit report.

## Direct network requests

Your browser may connect only to these services:

| Service | Purpose | Data involved |
| --- | --- | --- |
| `api.nuvio.tv` | TV sign-in, reading existing Nuvio data, importing, and verification | Approval session, temporary access token, selected profile data, and converted records |
| `api-two.nuvioapp.space` | Nuvio fallback API if the primary origin is unavailable | The same Nuvio request data |
| `nuvio.tv` | The approval page that you open explicitly | The approval code contained in the Nuvio-generated URL |
| `api.themoviedb.org` | Primary artwork, title metadata, and runtime lookup | Public TMDB/IMDb content identifiers and TV season/episode numbers only, after explicit consent |
| `v3-cinemeta.strem.io` | Runtime/metadata fallback when TMDB is unavailable or incomplete | Public IMDb content identifiers only, after explicit consent |

The application does not send your Trakt ZIP, Nuvio token, viewing timestamps, ratings, playback percentages, or Nuvio account data to TMDB or Cinemeta.

The deployed static bundle may contain a read-only TMDB application token. It identifies this application to TMDB and is not connected to a user's Trakt or Nuvio account. Because the application is static, that token should be considered publicly inspectable and must not be treated as a private user credential.

MetaHub artwork URLs are intentionally discarded and are not written into Nuvio by this importer.

## Hosting logs

The static site is hosted by GitHub Pages. Like ordinary web hosts, GitHub may receive and retain request information such as IP address, time, requested URL, user agent, and referring information subject to GitHub's own privacy terms. The application sets a `no-referrer` policy, but the project operator cannot control GitHub's infrastructure logs.

GitHub does not receive the ZIP merely because the site is hosted on GitHub Pages. ZIP parsing happens after the page has loaded and remains inside the browser.

TMDB and Cinemeta may receive ordinary network information such as the user's IP address when the browser sends a metadata request. Those requests go directly from the user's browser to the metadata provider and are not routed through the project operator.

## Fonts and third-party assets

Google Sans Flex and the ZIP parser are included in the built HTML. The page does not request fonts, scripts, stylesheets, analytics, or tracking assets from Google or another CDN.

Poster and background URLs saved into Nuvio come from TMDB when available. The importer itself does not need to render those poster images during the migration.

## Data deletion

Because the project operator does not collect application data, there is no application database from which to request deletion. Close the tab to discard its in-memory state. Backups and audit files that you download remain on your device until you delete them.

## Changes

Material changes to this document will be visible in the public Git history.
