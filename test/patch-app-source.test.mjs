import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { patchAppSource } from "../src/app-transform.mjs";

const source = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");

test("transform removes MetaHub persistence and uses a per-user in-memory TMDB token", () => {
  const patched = patchAppSource(source);
  assert.match(patched, /resolveMetadata/);
  assert.match(patched, /resolveTmdbMetadata/);
  assert.match(patched, /tmdbReadAccessToken: null/);
  assert.match(patched, /\$\("tmdb-token"\)\?\.value\.trim\(\)/);
  assert.match(patched, /state\.tmdbReadAccessToken = null/);
  assert.match(patched, /\$\("tmdb-token"\)\.value = ""/);
  assert.equal(patched.includes("__TMDB_READ_ACCESS_TOKEN__"), false);
  assert.equal(patched.includes("images.metahub.space"), false);
  assert.match(patched, /User-supplied TMDB primary when provided/);
  assert.match(patched, /metadataKey\(item\)/);
  assert.match(patched, /Cinemeta-only mode was used; artwork may be incomplete without TMDB/);
  assert.match(patched, /state\.plan\.progress\.map\(\(item\) => applyRuntime\(item, parseMetaRuntime\(state\.metadataById\.get\(metadataKey\(item\)\)\)\)\)/);
});

test("transform verifies Continue Watching semantically and recovers missing read-back items", () => {
  const patched = patchAppSource(source);
  assert.match(patched, /function progressIdentity/);
  assert.match(patched, /function compareProgressSemantics/);
  assert.match(patched, /newestByIdentity/);
  assert.match(patched, /requestedLimit = Math\.max\(10_000, Number\(expectedCount \|\| 0\) \+ 500\)/);
  assert.match(patched, /p_limit: requestedLimit/);
  assert.match(patched, /pullProgress\(profileId, strategy\.progress\.target\.length\)/);
  assert.match(patched, /retryDelays = \[0, 700, 1800, 3500, 6000\]/);
  assert.match(patched, /function progressRepairEntries/);
  assert.match(patched, /async function repairProgressEntries/);
  assert.match(patched, /Retrying only those items without clearing anything/);
  assert.match(patched, /value-mismatch=/);
  assert.match(patched, /Missing progress examples/);
  assert.doesNotMatch(patched, /\["progress", compareKeySets\(progressAfter, strategy\.progress\.target, progressKey\)\]/);
});

test("transform wires the four import modes, destructive verification, and repair-only flow", () => {
  const patched = patchAppSource(source);
  assert.match(patched, /buildImportStrategy/);
  assert.match(patched, /IMPORT_MODES\.MERGE_NEWER/);
  assert.match(patched, /sync_delete_watched_items/);
  assert.match(patched, /sync_delete_watch_progress/);
  assert.match(patched, /Fresh reset: clearing Nuvio Library/);
  assert.match(patched, /verifyStrategyResult/);
  assert.match(patched, /Verifying Library mirror before any watched\/progress removals/);
  assert.match(patched, /Watched and Continue Watching removals were not started/);
  assert.match(patched, /repairArtwork/);
  assert.match(patched, /Artwork repair complete and verified/);
  assert.equal(patched.includes("if (!state.plan) return;\n  const button = $(\"login-button\")"), false);
});

test("transform fails closed when the expected upstream source changes", () => {
  assert.throws(() => patchAppSource("unrelated source"), /expected source block was not found/);
});
