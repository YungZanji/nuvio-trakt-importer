import test from "node:test";
import assert from "node:assert/strict";
import { buildImportStrategy, IMPORT_MODES } from "../src/import-strategies.mjs";

const lib = (id, poster, added = 100) => ({ content_id: id, content_type: "movie", name: id, poster, added_at: added });
const watched = (id, watchedAt) => ({ content_id: id, content_type: "movie", title: id, season: null, episode: null, watched_at: watchedAt });
const progress = (id, lastWatched) => ({ content_id: id, content_type: "movie", video_id: id, season: null, episode: null, position: 10, duration: 100, last_watched: lastWatched, progress_key: id });

const remote = {
  library: [lib("tt1", "old.jpg"), lib("tt-old", "keep.jpg")],
  watchedItems: [watched("tt1", 200), watched("tt-old", 200)],
  watchProgress: [progress("tt1", 200), progress("tt-old", 200)],
};
const imported = {
  library: [lib("tt1", "tmdb.jpg", 150), lib("tt-new", "new.jpg")],
  watchedItems: [watched("tt1", 300), watched("tt-new", 300)],
  progress: [progress("tt1", 300), progress("tt-new", 300)],
};

test("add-only preserves existing records and only adds missing keys", () => {
  const plan = buildImportStrategy(IMPORT_MODES.ADD_ONLY, remote, imported);
  assert.equal(plan.library.target.find((item) => item.content_id === "tt1").poster, "old.jpg");
  assert.deepEqual(plan.library.upserts.map((item) => item.content_id), ["tt-new"]);
  assert.equal(plan.watched.upserts.length, 1);
  assert.equal(plan.progress.upserts.length, 1);
  assert.deepEqual(plan.preview.library, { added: 1, updated: 0, removed: 0, final: 3 });
});

test("recommended merge refreshes library metadata and only uses newer watched/progress", () => {
  const plan = buildImportStrategy(IMPORT_MODES.MERGE_NEWER, remote, imported);
  assert.equal(plan.library.target.find((item) => item.content_id === "tt1").poster, "tmdb.jpg");
  assert.equal(plan.library.target.find((item) => item.content_id === "tt1").added_at, 100);
  assert.equal(plan.watched.target.find((item) => item.content_id === "tt1").watched_at, 300);
  assert.equal(plan.progress.target.find((item) => item.content_id === "tt1").last_watched, 300);
  assert.equal(plan.preview.library.removed, 0);
});

test("mirror removes remote records that are absent from the import", () => {
  const plan = buildImportStrategy(IMPORT_MODES.MIRROR, remote, imported);
  assert.deepEqual(plan.library.target.map((item) => item.content_id), ["tt1", "tt-new"]);
  assert.deepEqual(plan.watched.deletes.map((item) => item.content_id), ["tt-old"]);
  assert.deepEqual(plan.progress.deletes.map((item) => item.content_id), ["tt-old"]);
  assert.equal(plan.preview.library.removed, 1);
});

test("fresh mode plans a full tracking-data clear before rebuilding", () => {
  const plan = buildImportStrategy(IMPORT_MODES.FRESH, remote, imported);
  assert.equal(plan.resetFirst, true);
  assert.equal(plan.library.deletes.length, remote.library.length);
  assert.equal(plan.watched.deletes.length, remote.watchedItems.length);
  assert.equal(plan.progress.deletes.length, remote.watchProgress.length);
  assert.equal(plan.library.target.length, imported.library.length);
});
