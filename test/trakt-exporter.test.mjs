import test from "node:test";
import assert from "node:assert/strict";
import { buildMergedTraktExport } from "../src/trakt-exporter.mjs";

function fixture() {
  const movie = { title: "Example Movie", year: 2024, ids: { imdb: "tt1000001", tmdb: 10, trakt: 20 } };
  const show = { title: "Example Show", year: 2023, ids: { imdb: "tt2000002", tmdb: 30, trakt: 40 } };
  return new Map([
    ["lists-watchlist.json", JSON.stringify([{ type: "movie", movie, listed_at: "2025-01-01T00:00:00Z" }])],
    ["watched-history-1.json", JSON.stringify([
      { type: "movie", movie, watched_at: "2025-02-01T00:00:00Z" },
      { type: "episode", show, episode: { season: 1, number: 1, title: "Pilot" }, watched_at: "2025-02-02T00:00:00Z" },
    ])],
    ["watched-movies-1.json", JSON.stringify([{ plays: 1, last_watched_at: "2025-02-01T00:00:00Z", movie }])],
    ["watched-shows.json", JSON.stringify([])],
    ["watched-playback.json", JSON.stringify([
      { type: "movie", movie, progress: 20, paused_at: "2025-02-03T00:00:00Z" },
      { type: "episode", show, episode: { season: 1, number: 2 }, progress: 30, paused_at: "2025-02-03T00:00:00Z" },
    ])],
    ["ratings-movies.json", JSON.stringify([{ movie, rating: 9 }])],
  ]);
}

test("maps every Nuvio Library item to the Trakt watchlist and preserves unrelated files", () => {
  const files = fixture();
  const result = buildMergedTraktExport(files, {
    library: [
      { content_id: "tt1000001", content_type: "movie", name: "Example Movie", added_at: Date.parse("2025-01-01") },
      { content_id: "tt2000002", content_type: "series", name: "Example Show", added_at: Date.parse("2026-01-01") },
      { content_id: "tmdb:999", content_type: "movie", name: "Nuvio Only", release_info: "2026", added_at: Date.parse("2026-01-02") },
    ],
    watchedItems: [],
    watchProgress: [],
  });

  const watchlist = JSON.parse(result.updates.get("lists-watchlist.json"));
  assert.equal(watchlist.length, 3);
  assert.equal(watchlist.filter((item) => item.type === "show").length, 1);
  assert.equal(watchlist.find((item) => item.movie?.title === "Nuvio Only").movie.ids.tmdb, 999);
  assert.equal(result.updates.has("ratings-movies.json"), false);
  assert.equal(result.summary.watchlistAdded, 2);
});

test("newer Nuvio watched timestamps supersede Trakt state without deleting old history", () => {
  const result = buildMergedTraktExport(fixture(), {
    library: [],
    watchedItems: [
      { content_id: "tt1000001", content_type: "movie", watched_at: Date.parse("2026-04-01T10:00:00Z") },
      { content_id: "tt2000002", content_type: "series", season: 1, episode: 1, watched_at: Date.parse("2024-01-01T00:00:00Z") },
      { content_id: "tt2000002", content_type: "series", season: 1, episode: 2, watched_at: Date.parse("2026-04-02T10:00:00Z") },
    ],
    watchProgress: [],
  });

  const history = JSON.parse(result.updates.get("watched-history-1.json"));
  assert.equal(history.length, 4);
  assert.ok(history.some((entry) => entry.type === "movie" && entry.watched_at === "2026-04-01T10:00:00.000Z"));
  assert.equal(history.filter((entry) => entry.type === "episode" && entry.episode.number === 1).length, 1);
  assert.ok(history.some((entry) => entry.type === "episode" && entry.episode.number === 2 && entry.watched_at === "2026-04-02T10:00:00.000Z"));
  assert.equal(result.summary.watchedAdded, 2);
});

test("newest playback timing wins and a later finished state removes stale playback", () => {
  const result = buildMergedTraktExport(fixture(), {
    library: [],
    watchedItems: [
      { content_id: "tt1000001", content_type: "movie", watched_at: Date.parse("2026-05-03T00:00:00Z") },
    ],
    watchProgress: [
      { content_id: "tt1000001", content_type: "movie", position: 80_000, duration: 100_000, last_watched: Date.parse("2026-05-02T00:00:00Z") },
      { content_id: "tt2000002", content_type: "series", season: 1, episode: 2, position: 45_000, duration: 100_000, last_watched: Date.parse("2026-05-04T00:00:00Z") },
    ],
  });

  const playback = JSON.parse(result.updates.get("watched-playback.json"));
  assert.equal(playback.some((entry) => entry.movie?.ids?.imdb === "tt1000001"), false);
  const episode = playback.find((entry) => entry.type === "episode" && entry.episode.number === 2);
  assert.equal(episode.progress, 45);
  assert.equal(episode.paused_at, "2026-05-04T00:00:00.000Z");
  assert.equal(result.summary.playbackRemovedBecauseFinished >= 1, true);
});

test("matches Nuvio TMDB IDs to the same Trakt media instead of creating duplicates", () => {
  const result = buildMergedTraktExport(fixture(), {
    library: [
      { content_id: "tmdb:10", content_type: "movie", name: "Example Movie", added_at: Date.parse("2026-01-01") },
    ],
    watchedItems: [
      { content_id: "tmdb:10", content_type: "movie", watched_at: Date.parse("2024-01-01T00:00:00Z") },
    ],
    watchProgress: [],
  });

  assert.equal(result.summary.watchlistAdded, 0);
  assert.equal(result.summary.watchedAdded, 0);
  assert.equal(result.updates.has("lists-watchlist.json"), false);
  assert.equal(result.updates.has("watched-history-1.json"), false);
});

test("updates an existing watched-movie summary in its original numbered file", () => {
  const files = fixture();
  const originalMovie = JSON.parse(files.get("watched-movies-1.json"))[0];
  files.set("watched-movies-2.json", JSON.stringify([]));

  const result = buildMergedTraktExport(files, {
    library: [],
    watchedItems: [
      { content_id: "tt1000001", content_type: "movie", watched_at: Date.parse("2026-06-01T00:00:00Z") },
    ],
    watchProgress: [],
  });

  const firstPage = JSON.parse(result.updates.get("watched-movies-1.json"));
  assert.equal(firstPage[0].plays, originalMovie.plays + 1);
  assert.equal(firstPage[0].last_watched_at, "2026-06-01T00:00:00.000Z");
  assert.equal(result.updates.has("watched-movies-2.json"), false);
});

test("does not rewrite unrelated or unchanged Trakt files when Nuvio has nothing newer", () => {
  const files = fixture();
  const result = buildMergedTraktExport(files, {
    library: [{ content_id: "tt1000001", content_type: "movie", added_at: Date.parse("2024-01-01") }],
    watchedItems: [{ content_id: "tt1000001", content_type: "movie", watched_at: Date.parse("2024-01-01") }],
    watchProgress: [],
  });

  assert.equal(result.updates.size, 0);
  assert.equal(result.summary.preservedFiles, files.size);
});
