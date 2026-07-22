# Privacy

Last updated: July 22, 2026

## Summary

Nuvio Trakt Importer is a static, browser-only application. The project operator does not run an application server and does not receive, store, or process your Trakt archive, Nuvio access token, Nuvio library, viewing history, watchlist, or Continue Watching data.

## Processing in your browser

Your selected Trakt ZIP is read from the browser File API and parsed in memory. The ZIP is not submitted to GitHub, the project operator, Nuvio, Cinemeta, or any other service.

The application does not use cookies, `localStorage`, `sessionStorage`, IndexedDB, service workers, analytics, advertising, tracking pixels, telemetry, or crash-reporting services. Closing the tab clears the in-memory application state and Nuvio tokens.

The app may create downloads only after an action you request, such as the mandatory pre-import backup and final audit report.

## Direct network requests

Your browser may connect only to these services:

| Service | Purpose | Data involved |
| --- | --- | --- |
| `api.nuvio.tv` | TV sign-in, reading existing Nuvio data, importing, and verification | Approval session, temporary access token, selected profile data, and converted records |
| `api-two.nuvioapp.space` | Nuvio fallback API if the primary origin is unavailable | The same Nuvio request data |
| `nuvio.tv` | The approval page that you open explicitly | The approval code contained in the Nuvio-generated URL |
| `v3-cinemeta.strem.io` | Optional artwork and runtime lookup | Public IMDb content identifiers only, after explicit consent |

The application does not send your Trakt ZIP, Nuvio token, viewing timestamps, ratings, playback percentages, or Nuvio account data to Cinemeta.

## Hosting logs

The static site is hosted by GitHub Pages. Like ordinary web hosts, GitHub may receive and retain request information such as IP address, time, requested URL, user agent, and referring information subject to GitHub's own privacy terms. The application sets a `no-referrer` policy, but the project operator cannot control GitHub's infrastructure logs.

GitHub does not receive the ZIP merely because the site is hosted on GitHub Pages. ZIP parsing happens after the page has loaded and remains inside the browser.

## Fonts and third-party assets

Google Sans Flex and the ZIP parser are included in the built HTML. The page does not request fonts, scripts, stylesheets, images, or analytics from Google or another CDN.

## Data deletion

Because the project operator does not collect application data, there is no application database from which to request deletion. Close the tab to discard its in-memory state. Backups and audit files that you download remain on your device until you delete them.

## Changes

Material changes to this document will be visible in the public Git history.
