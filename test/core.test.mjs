import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  NUVIO_PUBLIC_ANON_KEY,
  applyRuntime,
  buildImportPlan,
  mergeLibrary,
  mergeProgress,
  mergeWatchedItems,
  parseRuntimeMinutes,
  stripPrivateFields,
} from "../src/core.mjs";

test("uses Nuvio's complete public anonymous JWT", () => {
  const segments = NUVIO_PUBLIC_ANON_KEY.split(".");
  assert.equal(segments.length, 3);
  const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  assert.equal(payload.role, "anon");
  assert.equal(payload.iss, "supabase");
});

function fixtureFiles() {
  const movie = { title: "Example Movie", year: 2024, ids: { imdb: "tt1000001", tmdb: 10, trakt: 20 } };
  const show = { title: "Example Show", year: 2023, ids: { imdb: "tt2000002", tmdb: 30, trakt: 40 } };
  return new Map([
    ["lists-watchlist.json", JSON.stringify([
      { type: "movie", movie, listed_at: "2025-01-01T00:00:00Z" },
      { type: "show", show, listed_at: "2025-01-02T00:00:00Z" },
    ])],
    ["watched-movies-1.json", JSON.stringify([
      { movie, last_watched_at: "2025-02-01T00:00:00Z" },
    ])],
    ["watched-history-1.json", JSON.stringify([
      { type: "episode", show, episode: { season: 1, number: 1, title: "Pilot" }, watched_at: "2025-02-02T00:00:00Z" },
      { type: "episode", show, episode: { season: 1, number: 1, title: "Pilot" }, watched_at: "2025-02-03T00:00:00Z" },
      { type: "movie", movie, watched_at: "2025-02-04T00:00:00Z" },
    ])],
    ["watched-playback.json", JSON.stringify([
      { type: "episode", show, episode: { season: 1, number: 2, title: "Second" }, progress: 25, paused_at: "2025-02-05T00:00:00Z" },
    ])],
    ["ratings-movies.json", JSON.stringify([{ movie, rating: 9 }])],
    ["lists-lists.json", JSON.stringify([{ name: "Personal" }])],
    ["lists-list-1-personal.json", JSON.stringify([{ type: "movie", movie }])],
  ]);
}

test("converts watchlist, watched state, and playback without double-counting history", () => {
  const plan = buildImportPlan(fixtureFiles());
  assert.equal(plan.library.length, 2);
  assert.equal(plan.watchedItems.length, 2);
  assert.equal(plan.watchedItems.filter((item) => item.content_type === "series").length, 1);
  assert.equal(plan.progress.length, 1);
  assert.equal(plan.progress[0].progress_key, "tt2000002_s1e2");
  assert.equal(plan.sourceSummary.historyPlays, 3);
  assert.equal(plan.unsupported.ratings, 1);
  assert.equal(plan.unsupported.personalLists, 1);
  assert.equal(plan.unsupported.personalListItems, 1);
});

test("keeps the newest duplicate watched timestamp", () => {
  const plan = buildImportPlan(fixtureFiles());
  const episode = plan.watchedItems.find((item) => item.content_type === "series");
  assert.equal(episode.watched_at, Date.parse("2025-02-03T00:00:00Z"));
});

test("parses runtime formats and converts percentages to milliseconds", () => {
  assert.equal(parseRuntimeMinutes("136 min"), 136);
  assert.equal(parseRuntimeMinutes("1h 35min"), 95);
  const item = buildImportPlan(fixtureFiles()).progress[0];
  const applied = applyRuntime(item, "40 min");
  assert.equal(applied.duration, 2_400_000);
  assert.equal(applied.position, 600_000);
});

test("merge helpers preserve remote data and prefer newer timestamps", () => {
  const plan = buildImportPlan(fixtureFiles());
  const mergedLibrary = mergeLibrary([
    { ...stripPrivateFields(plan.library[0]), name: "Existing title", poster: "existing.jpg" },
    { content_id: "tt9999999", content_type: "movie", name: "Remote only", added_at: 1, genres: [] },
  ], plan.library);
  assert.equal(mergedLibrary.length, 3);
  assert.equal(mergedLibrary.find((item) => item.content_id === plan.library[0].content_id).poster, "existing.jpg");

  const importedWatched = plan.watchedItems[0];
  const olderRemote = { ...importedWatched, watched_at: importedWatched.watched_at - 1 };
  assert.equal(mergeWatchedItems([olderRemote], [importedWatched])[0].watched_at, importedWatched.watched_at);

  const importedProgress = applyRuntime(plan.progress[0], 40);
  const newerRemote = { ...stripPrivateFields(importedProgress), last_watched: importedProgress.last_watched + 1 };
  assert.equal(mergeProgress([newerRemote], [importedProgress])[0].last_watched, newerRemote.last_watched);
});

test("validates the supplied export when TRAKT_EXPORT_DIR is set", { skip: !process.env.TRAKT_EXPORT_DIR }, async () => {
  const directory = process.env.TRAKT_EXPORT_DIR;
  const files = new Map();
  for (const name of await readdir(directory)) {
    if (name.endsWith(".json")) files.set(name, await readFile(join(directory, name), "utf8"));
  }
  const plan = buildImportPlan(files);
  assert.ok(plan.sourceFiles.length > 0);
  assert.ok(Array.isArray(plan.library));
  assert.ok(Array.isArray(plan.watchedItems));
  assert.ok(Array.isArray(plan.progress));
  assert.equal(plan.parseErrors.length, 0);
  assert.equal(plan.missingIds.length, 0);
});
