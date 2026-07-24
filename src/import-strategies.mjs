const libraryKey = (item) => `${String(item?.content_type || "").toLowerCase()}|${item?.content_id || ""}`;
const watchedKey = (item) => `${item?.content_id || ""}|${item?.season ?? ""}|${item?.episode ?? ""}`;
const progressKey = (item) => item?.progress_key || (item?.season != null && item?.episode != null
  ? `${item?.content_id}_s${item.season}e${item.episode}`
  : item?.content_id || "");

export const IMPORT_MODES = Object.freeze({
  ADD_ONLY: "add_only",
  MERGE_NEWER: "merge_newer",
  MIRROR: "mirror",
  FRESH: "fresh",
});

export const IMPORT_MODE_DETAILS = Object.freeze({
  [IMPORT_MODES.ADD_ONLY]: {
    label: "Only bring new items",
    badge: "SAFE",
    description: "Adds Trakt items that are not already in Nuvio. Existing Nuvio items stay exactly as they are, and nothing is removed.",
  },
  [IMPORT_MODES.MERGE_NEWER]: {
    label: "Merge & refresh",
    badge: "RECOMMENDED",
    description: "Adds new items, keeps the newest watched/progress timestamps, and refreshes existing library metadata when the import has a useful replacement. Nothing is removed.",
  },
  [IMPORT_MODES.MIRROR]: {
    label: "Mirror the Trakt import",
    badge: "ADVANCED",
    description: "Makes the three supported Nuvio tracking categories match this Trakt import. Items missing from the import are removed from those categories.",
  },
  [IMPORT_MODES.FRESH]: {
    label: "Reset tracking data & import fresh",
    badge: "DANGER",
    description: "Clears this profile's Nuvio Library, watched status, and Continue Watching data, verifies they are empty, then rebuilds them from the Trakt import.",
  },
});

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, child]) => [key, clean(child)]));
}

function indexed(items, keyFn) {
  return new Map((items || []).map((item) => [keyFn(item), item]));
}

function meaningful(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && value !== "";
}

function refreshLibraryItem(remote, imported) {
  if (!remote) return clean(imported);
  const incoming = clean(imported);
  const result = { ...remote };
  for (const field of ["name", "poster", "background", "description", "release_info", "imdb_rating", "genres", "addon_base_url"]) {
    if (meaningful(incoming[field])) result[field] = incoming[field];
  }
  result.poster_shape = remote.poster_shape || incoming.poster_shape || "POSTER";
  const remoteAdded = Number(remote.added_at || 0);
  const importedAdded = Number(incoming.added_at || 0);
  result.added_at = remoteAdded && importedAdded ? Math.min(remoteAdded, importedAdded) : (remoteAdded || importedAdded || Date.now());
  return result;
}

function addOnly(remoteItems, importedItems, keyFn) {
  const map = indexed(remoteItems, keyFn);
  const upserts = [];
  for (const imported of importedItems || []) {
    const key = keyFn(imported);
    if (!map.has(key)) {
      const item = clean(imported);
      map.set(key, item);
      upserts.push(item);
    }
  }
  return { target: [...map.values()], upserts, deletes: [] };
}

function newer(remoteItems, importedItems, keyFn, timestampField) {
  const map = indexed(remoteItems, keyFn);
  const upserts = [];
  for (const importedRaw of importedItems || []) {
    const imported = clean(importedRaw);
    const key = keyFn(imported);
    const remote = map.get(key);
    if (!remote || Number(imported[timestampField] || 0) > Number(remote[timestampField] || 0)) {
      map.set(key, imported);
      upserts.push(imported);
    }
  }
  return { target: [...map.values()], upserts, deletes: [] };
}

function mergeLibrary(remoteItems, importedItems) {
  const map = indexed(remoteItems, libraryKey);
  const upserts = [];
  for (const importedRaw of importedItems || []) {
    const key = libraryKey(importedRaw);
    const remote = map.get(key);
    const merged = refreshLibraryItem(remote, importedRaw);
    map.set(key, merged);
    if (!remote || JSON.stringify(remote) !== JSON.stringify(merged)) upserts.push(merged);
  }
  return { target: [...map.values()], upserts, deletes: [] };
}

function mirror(remoteItems, importedItems, keyFn) {
  const remoteMap = indexed(remoteItems, keyFn);
  const imported = (importedItems || []).map(clean);
  const importedMap = indexed(imported, keyFn);
  const deletes = [...remoteMap.entries()].filter(([key]) => !importedMap.has(key)).map(([, item]) => item);
  return { target: imported, upserts: imported, deletes };
}

function fresh(remoteItems, importedItems) {
  return {
    target: (importedItems || []).map(clean),
    upserts: (importedItems || []).map(clean),
    deletes: (remoteItems || []).map(clean),
  };
}

function countChanges(remoteItems, targetItems, keyFn) {
  const remote = indexed(remoteItems, keyFn);
  const target = indexed(targetItems, keyFn);
  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const [key, item] of target) {
    if (!remote.has(key)) added++;
    else if (JSON.stringify(remote.get(key)) !== JSON.stringify(item)) updated++;
  }
  for (const key of remote.keys()) if (!target.has(key)) removed++;
  return { added, updated, removed, final: target.size };
}

export function buildImportStrategy(mode, remote, imported) {
  const remoteLibrary = remote?.library || [];
  const remoteWatched = remote?.watchedItems || [];
  const remoteProgress = remote?.watchProgress || [];
  const importedLibrary = imported?.library || [];
  const importedWatched = imported?.watchedItems || [];
  const importedProgress = imported?.progress || [];

  let library;
  let watched;
  let progress;

  switch (mode) {
    case IMPORT_MODES.ADD_ONLY:
      library = addOnly(remoteLibrary, importedLibrary, libraryKey);
      watched = addOnly(remoteWatched, importedWatched, watchedKey);
      progress = addOnly(remoteProgress, importedProgress, progressKey);
      break;
    case IMPORT_MODES.MIRROR:
      library = mirror(remoteLibrary, importedLibrary, libraryKey);
      watched = mirror(remoteWatched, importedWatched, watchedKey);
      progress = mirror(remoteProgress, importedProgress, progressKey);
      break;
    case IMPORT_MODES.FRESH:
      library = fresh(remoteLibrary, importedLibrary);
      watched = fresh(remoteWatched, importedWatched);
      progress = fresh(remoteProgress, importedProgress);
      break;
    case IMPORT_MODES.MERGE_NEWER:
    default:
      library = mergeLibrary(remoteLibrary, importedLibrary);
      watched = newer(remoteWatched, importedWatched, watchedKey, "watched_at");
      progress = newer(remoteProgress, importedProgress, progressKey, "last_watched");
      break;
  }

  return {
    mode,
    resetFirst: mode === IMPORT_MODES.FRESH,
    library,
    watched,
    progress,
    preview: {
      library: countChanges(remoteLibrary, library.target, libraryKey),
      watched: countChanges(remoteWatched, watched.target, watchedKey),
      progress: countChanges(remoteProgress, progress.target, progressKey),
    },
  };
}

export function watchedDeleteKey(item) {
  return {
    content_id: item.content_id,
    ...(item.season != null ? { season: Number(item.season) } : {}),
    ...(item.episode != null ? { episode: Number(item.episode) } : {}),
  };
}

export function progressDeleteKey(item) {
  return progressKey(item);
}

export { libraryKey, watchedKey, progressKey, refreshLibraryItem };
