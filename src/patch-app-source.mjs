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
    '  metadataById: new Map(),\n',
    '  metadataById: new Map(),\n  tmdbReadAccessToken: null,\n',
    "in-memory TMDB token state",
  );
  output = replaceOnce(
    output,
    `async function fetchCinemeta(item) {\n  if (!item.content_id?.startsWith("tt")) return null;\n  const type = item.content_type === "movie" ? "movie" : "series";\n  const response = await fetch(\`${'${CINEMETA_BASE}'}/meta/${'${type}'}/${'${encodeURIComponent(item.content_id)}'}.json\`);\n  if (!response.ok) throw new Error(\`Cinemeta ${'${response.status}'}\`);\n  const body = await response.json();\n  return body?.meta ?? null;\n}\n`,
    `async function fetchCinemeta(item) {\n  return resolveMetadata(item, {\n    tmdbReadAccessToken: state.tmdbReadAccessToken || "",\n    cinemetaBase: CINEMETA_BASE,\n  });\n}\n\nfunction metadataKey(item) {\n  const season = Number(item.season);\n  const episode = Number(item.episode);\n  return item.content_type === "series" && Number.isInteger(season) && Number.isInteger(episode)\n    ? \`${'${item.content_id}'}:s${'${season}'}e${'${episode}'}\`\n    : item.content_id;\n}\n`,
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
    '    setStatus("Please approve the metadata lookup first. Only public IMDb IDs are sent, never your ZIP, Nuvio account, timestamps, or ratings.", "error");\n',
    '    setStatus("Please approve the metadata lookup first. Only public media IDs and episode numbers are sent, never your ZIP, Nuvio account, timestamps, ratings, or playback percentages.", "error");\n',
    "metadata consent status",
  );
  output = replaceOnce(
    output,
    '  const button = $("metadata-button");\n  setBusy(button, true, "Resolving metadata…");\n  try {\n',
    '  const button = $("metadata-button");\n  state.tmdbReadAccessToken = $("tmdb-token")?.value.trim() || "";\n  setBusy(button, true, "Resolving metadata…");\n  try {\n',
    "capture user TMDB token",
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
    '    $("metadata-state").textContent = state.unresolvedProgress.length\n      ? `${state.unresolvedProgress.length} resume item(s) still need a runtime.`\n      : `All ${state.plan.progress.length} resume positions have a runtime.`;\n',
    '    const providerNote = state.tmdbReadAccessToken\n      ? " TMDB was used first; Cinemeta was available only as fallback."\n      : " Cinemeta-only mode was used; artwork may be incomplete without TMDB.";\n    $("metadata-state").textContent = (state.unresolvedProgress.length\n      ? `${state.unresolvedProgress.length} resume item(s) still need a runtime.`\n      : `All ${state.plan.progress.length} resume positions have a runtime.`) + providerNote;\n',
    "metadata provider status",
  );
  output = replaceOnce(
    output,
    '  } finally {\n    setBusy(button, false);\n  }\n}\n\nfunction applyManualRuntimes',
    '  } finally {\n    state.tmdbReadAccessToken = null;\n    if ($("tmdb-token")) $("tmdb-token").value = "";\n    setBusy(button, false);\n  }\n}\n\nfunction applyManualRuntimes',
    "clear TMDB token after lookup",
  );
  output = replaceOnce(
    output,
    '        provider: "Cinemeta (public IMDb metadata)",\n',
    '        provider: "User-supplied TMDB primary when provided; Cinemeta runtime/metadata fallback; MetaHub artwork disabled",\n',
    "audit provider label",
  );
  output = replaceOnce(
    output,
    '  state.token = null;\n  state.refreshToken = null;\n});\n',
    '  state.token = null;\n  state.refreshToken = null;\n  state.tmdbReadAccessToken = null;\n  if ($("tmdb-token")) $("tmdb-token").value = "";\n});\n',
    "clear TMDB token on unload",
  );
  return output;
}
