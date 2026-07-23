import test from "node:test";
import assert from "node:assert/strict";
import { isMetaHubUrl, resolveMetadata } from "../src/metadata-provider.mjs";

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("TMDB is primary and produces TMDB CDN artwork", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("/movie/27205")) return jsonResponse({ title: "Inception", poster_path: "/poster.jpg", backdrop_path: "/back.jpg", overview: "Dreams", release_date: "2010-07-15", runtime: 148, genres: [{ name: "Science Fiction" }] });
    throw new Error(`unexpected ${url}`);
  };
  const meta = await resolveMetadata({ content_id: "tt1375666", content_type: "movie", _ids: { tmdb: 27205, imdb: "tt1375666" } }, { tmdbReadAccessToken: "token", fetchImpl });
  assert.equal(meta.poster, "https://image.tmdb.org/t/p/w500/poster.jpg");
  assert.equal(meta.background, "https://image.tmdb.org/t/p/w1280/back.jpg");
  assert.equal(meta.runtime, 148);
  assert.equal(calls.some((url) => url.includes("cinemeta")), false);
});

test("TMDB-only TV progress uses episode runtime", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/tv/1399/season/1/episode/1")) return jsonResponse({ runtime: 62 });
    if (url.includes("/tv/1399")) return jsonResponse({ name: "Game of Thrones", poster_path: "/got.jpg", backdrop_path: "/got-bg.jpg", first_air_date: "2011-04-17", episode_run_time: [57], genres: [] });
    throw new Error(`unexpected ${url}`);
  };
  const meta = await resolveMetadata({ content_id: "tmdb:1399", content_type: "series", season: 1, episode: 1, _ids: { tmdb: 1399 } }, { tmdbReadAccessToken: "token", fetchImpl });
  assert.equal(meta.runtime, 62);
  assert.equal(meta.poster, "https://image.tmdb.org/t/p/w500/got.jpg");
});

test("Cinemeta fallback keeps runtime but strips MetaHub artwork", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("api.themoviedb.org")) return jsonResponse({}, 500);
    if (url.includes("v3-cinemeta.strem.io")) return jsonResponse({ meta: { name: "Example", poster: "https://images.metahub.space/poster/small/tt1/img", background: "https://images.metahub.space/background/medium/tt1/img", runtime: "45 min", genres: ["Drama"] } });
    throw new Error(`unexpected ${url}`);
  };
  const meta = await resolveMetadata({ content_id: "tt1", content_type: "series", _ids: { imdb: "tt1" } }, { tmdbReadAccessToken: "token", fetchImpl });
  assert.equal(meta.poster, null);
  assert.equal(meta.background, null);
  assert.equal(meta.runtime, "45 min");
  assert.equal(isMetaHubUrl("https://images.metahub.space/x"), true);
});
