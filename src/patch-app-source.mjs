function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Could not patch ${label}: expected source block was not found`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`Could not patch ${label}: source block was not unique`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

export function patchAppSource(source) {
  let output = source;
  output = replaceOnce(
    output,
    'import { unzipSync, strFromU8 } from "fflate";\n',
    'import { unzipSync, strFromU8 } from "fflate";\nimport { resolveMetadata } from "./metadata-provider.mjs";\n',
    "metadata provider import",
  );
  output = replaceOnce(
    output,
    'const REQUEST_TIMEOUT_MS = 15_000;\n',
    'const REQUEST_TIMEOUT_MS = 15_000;\nconst TMDB_READ_ACCESS_TOKEN = __TMDB_READ_ACCESS_TOKEN__;\n',
    "TMDB deployment token",
  );
  output = replaceOnce(
    output,
    `async function fetchCinemeta(item) {\n  if (!item.content_id?.startsWith("tt")) return null;\n  const type = item.content_type === "movie" ? "movie" : "series";\n  const response = await fetch(\`${'${CINEMETA_BASE}'}/meta/${'${type}'}/${'${encodeURIComponent(item.content_id)}'}.json\`);\n  if (!response.ok) throw new Error(\`Cinemeta ${'${response.status}'}\`);\n  const body = await response.json();\n  return body?.meta ?? null;\n}\n`,
    `async function fetchCinemeta(item) {\n  return resolveMetadata(item, {\n    tmdbReadAccessToken: TMDB_READ_ACCESS_TOKEN,\n    cinemetaBase: CINEMETA_BASE,\n  });\n}\n\nfunction metadataKey(item) {\n  const season = Number(item.season);\n  const episode = Number(item.episode);\n  return item.content_type === "series" && Number.isInteger(season) && Number.isInteger(episode)\n    ? \`${'${item.content_id}'}:s${'${season}'}e${'${episode}'}\`\n    : item.content_id;\n}\n`,
    "metadata lookup",
  );
  output = replaceOnce(
    output,
    '    poster: meta?.poster || (imdbFallback ? `https://images.metahub.space/poster/small/${imdbFallback}/img` : item.poster),\n',
    '    poster: meta?.poster || item.poster,\n',
    "poster fallback",
  );
  output = replaceOnce(
    output,
    '    background: meta?.background || (imdbFallback ? `https://images.metahub.space/background/medium/${imdbFallback}/img` : item.background),\n',
    '    background: meta?.background || item.background,\n',
    "background fallback",
  );
  output = replaceOnce(
    output,
    '    addon_base_url: item.addon_base_url || `${CINEMETA_BASE}/manifest.json`,\n',
    '    addon_base_url: item.addon_base_url || (imdbFallback ? `${CINEMETA_BASE}/manifest.json` : null),\n',
    "TMDB-only addon source",
  );
  output = replaceOnce(
    output,
    `    for (const item of [...state.plan.library, ...state.plan.progress]) {\n      if (!unique.has(item.content_id)) unique.set(item.content_id, item);\n    }\n`,
    `    for (const item of [...state.plan.library, ...state.plan.progress]) {\n      const key = metadataKey(item);\n      if (!unique.has(key)) unique.set(key, item);\n    }\n`,
    "metadata deduplication",
  );
  output = replaceOnce(
    output,
    '      if (result && !result.error) state.metadataById.set(items[index].content_id, result);\n',
    '      if (result && !result.error) state.metadataById.set(metadataKey(items[index]), result);\n',
    "metadata cache key",
  );
  output = replaceOnce(
    output,
    '    state.plan.library = state.plan.library.map((item) => hydrateLibraryItem(item, state.metadataById.get(item.content_id)));\n',
    '    state.plan.library = state.plan.library.map((item) => hydrateLibraryItem(item, state.metadataById.get(metadataKey(item))));\n',
    "library metadata key",
  );
  output = replaceOnce(
    output,
    '    state.plan.progress = state.plan.progress.map((item) => applyRuntime(item, parseMetaRuntime(state.metadataById.get(item.content_id))));\n',
    '    state.plan.progress = state.plan.progress.map((item) => applyRuntime(item, parseMetaRuntime(state.metadataById.get(metadataKey(item)))));\n',
    "progress metadata key",
  );
  output = replaceOnce(
    output,
    '        provider: "Cinemeta (public IMDb metadata)",\n',
    '        provider: "TMDB primary; Cinemeta runtime/metadata fallback; MetaHub artwork disabled",\n',
    "audit provider label",
  );
  return output;
}
