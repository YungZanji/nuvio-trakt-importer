# Changelog

All notable user-facing changes to the Trakt → Nuvio Sync Importer are documented here.

## v1.2.0 — 2026-07-24

### Import strategies

The importer no longer assumes a single merge behavior. After reading the selected Nuvio profile, it now presents four clearly separated strategies and previews the projected changes before anything is written.

- **Only bring new items** — adds missing Trakt records while leaving existing matching Nuvio records untouched.
- **Merge & refresh** — recommended default; adds missing records, refreshes useful Library metadata, and keeps the newer watched/progress timestamp.
- **Mirror the Trakt import** — makes Library, watched status, and Continue Watching match the imported set for the supported categories.
- **Reset tracking data & import fresh** — clears the supported tracking categories, verifies the clear, and rebuilds them from the Trakt export.

### Destructive-operation safeguards

- Pre-change backup remains mandatory before write operations.
- Mirror mode requires a typed `MIRROR` confirmation.
- Fresh reset requires a typed `RESET` confirmation.
- Mirror now verifies the requested Library state before any watched-status or Continue Watching removals begin.
- Fresh reset verifies the Library is empty before progressing to watched/progress deletion.
- Fresh reset verifies watched status and Continue Watching are empty before rebuilding from Trakt.
- Final results are pulled back from Nuvio and compared against the selected strategy.

### Artwork repair tool

A new **Repair existing artwork** workflow can be used without selecting a Trakt ZIP.

- Reads the current Nuvio Library.
- Uses the user's own TMDB API Read Access Token.
- Refreshes compatible poster and background URLs through TMDB.
- Does not intentionally change Library membership, watched status, Continue Watching, or tracking timestamps.
- Reads the Library back and verifies the repaired artwork values.
- Clears the TMDB token from the page after the operation.

### Metadata improvements

- TMDB remains the recommended primary metadata provider.
- Cinemeta remains available as a fallback for supported metadata/runtime lookups.
- MetaHub artwork URLs are intentionally rejected rather than persisted into Nuvio.
- Metadata lookup supports stable per-episode cache keys for TV playback entries.

### Interface

- Added large visual strategy cards with Safe, Recommended, Advanced, and Danger states.
- Added projected add/update/remove/final counts for Library, watched status, and Continue Watching.
- Added a standalone artwork-repair panel.
- Nuvio sign-in can now be used for artwork repair without first loading a Trakt ZIP.

### Build and validation

- Added automated strategy-planning tests for all four modes.
- Expanded transformed-app regression tests for deletion, reset, verification, and repair-only behavior.
- Added downloadable pull-request preview artifacts.
- Hardened bundle generation so minified JavaScript replacement sequences cannot corrupt the generated self-contained HTML.
- Build, tests, and privacy/bundle verification pass for the v1.2.0 implementation.

## v1.1.0

- Added user-supplied TMDB API Read Access Token support.
- Added TMDB-first metadata and artwork lookup with Cinemeta fallback.
- Rejected MetaHub artwork URLs that could produce broken posters in Nuvio.
- Added TMDB-only content-ID support and episode-specific runtime handling.
- Strengthened privacy controls around TMDB credentials and the self-contained bundle.
