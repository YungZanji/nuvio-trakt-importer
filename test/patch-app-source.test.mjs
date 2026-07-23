import test from "node:test";
import assert from "node:assert/strict";
import { patchAppSource } from "../src/patch-app-source.mjs";

const fixture = `import { unzipSync, strFromU8 } from "fflate";\nconst CINEMETA_BASE = "https://v3-cinemeta.strem.io";\nconst REQUEST_TIMEOUT_MS = 15_000;\nasync function fetchCinemeta(item) {\n  if (!item.content_id?.startsWith("tt")) return null;\n  const type = item.content_type === "movie" ? "movie" : "series";\n  const response = await fetch(\`${'${CINEMETA_BASE}'}/meta/${'${type}'}/${'${encodeURIComponent(item.content_id)}'}.json\`);\n  if (!response.ok) throw new Error(\`Cinemeta ${'${response.status}'}\`);\n  const body = await response.json();\n  return body?.meta ?? null;\n}\nfunction hydrateLibraryItem(item, meta) {\n  const imdbFallback = item.content_id.startsWith("tt") ? item.content_id : null;\n  return {\n    poster: meta?.poster || (imdbFallback ? \`https://images.metahub.space/poster/small/${'${imdbFallback}'}/img\` : item.poster),\n    background: meta?.background || (imdbFallback ? \`https://images.metahub.space/background/medium/${'${imdbFallback}'}/img\` : item.background),\n    addon_base_url: item.addon_base_url || \`${'${CINEMETA_BASE}'}/manifest.json\`,\n  };\n}\nasync function enrichMetadata() {\n  if (!state.plan) return;\n  if (!("metadata-consent")) {\n    setStatus("Please approve the metadata lookup first. Only public IMDb IDs are sent, never your ZIP, Nuvio account, timestamps, or ratings.", "error");\n    return;\n  }\n  const unique = new Map();\n    for (const item of [...state.plan.library, ...state.plan.progress]) {\n      if (!unique.has(item.content_id)) unique.set(item.content_id, item);\n    }\n  const items = [...unique.values()];\n  results.forEach((result, index) => {\n      if (result && !result.error) state.metadataById.set(items[index].content_id, result);\n  });\n    state.plan.library = state.plan.library.map((item) => hydrateLibraryItem(item, state.metadataById.get(item.content_id)));\n    state.plan.progress = state.plan.progress.map((item) => applyRuntime(item, parseMetaRuntime(state.metadataById.get(item.content_id))));\n}\nconst audit = { metadata: {\n        provider: "Cinemeta (public IMDb metadata)",\n} };\n`;

test("patch removes MetaHub persistence and wires TMDB-first metadata", () => {
  const patched = patchAppSource(fixture);
  assert.match(patched, /resolveMetadata/);
  assert.match(patched, /__TMDB_READ_ACCESS_TOKEN__/);
  assert.equal(patched.includes("images.metahub.space"), false);
  assert.match(patched, /TMDB primary; Cinemeta runtime\/metadata fallback/);
  assert.match(patched, /metadataKey\(item\)/);
  assert.match(patched, /addon_base_url: item\.addon_base_url \|\| \(imdbFallback/);
  assert.match(patched, /Only public media IDs and episode numbers are sent/);
});

test("patch fails closed when the expected upstream source changes", () => {
  assert.throws(() => patchAppSource("unrelated source"), /expected source block was not found/);
});
