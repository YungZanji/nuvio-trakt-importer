import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { patchAppSource } from "../src/patch-app-source.mjs";

const source = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");

test("patch removes MetaHub persistence and uses a per-user in-memory TMDB token", () => {
  const patched = patchAppSource(source);
  assert.match(patched, /resolveMetadata/);
  assert.match(patched, /tmdbReadAccessToken: null/);
  assert.match(patched, /\$\("tmdb-token"\)\?\.value\.trim\(\)/);
  assert.match(patched, /state\.tmdbReadAccessToken = null/);
  assert.match(patched, /\$\("tmdb-token"\)\.value = ""/);
  assert.equal(patched.includes("__TMDB_READ_ACCESS_TOKEN__"), false);
  assert.equal(patched.includes("images.metahub.space"), false);
  assert.match(patched, /User-supplied TMDB primary when provided/);
  assert.match(patched, /metadataKey\(item\)/);
  assert.match(patched, /Cinemeta-only mode was used; artwork may be incomplete without TMDB/);
});

test("patch fails closed when the expected upstream source changes", () => {
  assert.throws(() => patchAppSource("unrelated source"), /expected source block was not found/);
});
