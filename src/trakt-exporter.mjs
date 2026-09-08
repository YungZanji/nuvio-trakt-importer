const asArray = (value) => Array.isArray(value) ? value : [];

function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value) {
  const timestamp = parseTimestamp(value);
  return timestamp > 0 ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function basename(path) {
  return String(path || "").split("/").pop();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function numericId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function idsFromContentId(contentId) {
  const raw = String(contentId || "").trim();
  if (/^tt\d+$/i.test(raw)) return { imdb: raw };
  if (/^tmdb:\d+$/i.test(raw)) return { tmdb: Number(raw.slice(5)) };
  if (/^trakt:\d+$/i.test(raw)) return { trakt: Number(raw.slice(6)) };
  if (/^tvdb:\d+$/i.test(raw)) return { tvdb: Number(raw.slice(5)) };
  return {};
}

function mediaKeys(ids = {}) {
  const keys = [];
  const imdb = typeof ids.imdb === "string" ? ids.imdb.trim() : "";
  if (imdb) keys.push(`imdb:${imdb.toLowerCase()}`);
  const tmdb = numericId(ids.tmdb);
  if (tmdb) keys.push(`tmdb:${tmdb}`);
  const trakt = numericId(ids.trakt);
  if (trakt) keys.push(`trakt:${trakt}`);
  const tvdb = numericId(ids.tvdb);
  if (tvdb) keys.push(`tvdb:${tvdb}`);
  return keys;
}

function rawContentKey(contentId) {
  const ids = idsFromContentId(contentId);
  return mediaKeys(ids)[0] || String(contentId || "").trim().toLowerCase();
}

function buildMediaIndex(parsedFiles) {
  const aliases = new Map();
  const media = new Map();
  const episodes = new Map();

  function canonicalForKeys(keys) {
    for (const key of keys) {
      const known = aliases.get(key);
      if (known) return known;
    }
    return keys[0] || "";
  }

  function mergeAliases(keys, canonical) {
    const relatedCanonicals = new Set(keys.map((key) => aliases.get(key)).filter(Boolean));
    if (canonical) relatedCanonicals.add(canonical);
    const preferred = [...relatedCanonicals][0] || canonical;
    if (!preferred) return "";

    if (relatedCanonicals.size > 1) {
      for (const [key, value] of aliases) {
        if (relatedCanonicals.has(value)) aliases.set(key, preferred);
      }
      for (const oldCanonical of relatedCanonicals) {
        if (oldCanonical === preferred) continue;
        if (!media.has(preferred) && media.has(oldCanonical)) media.set(preferred, media.get(oldCanonical));
        media.delete(oldCanonical);
      }
    }
    for (const key of keys) aliases.set(key, preferred);
    return preferred;
  }

  function indexMedia(value, type) {
    if (!value || typeof value !== "object") return "";
    const keys = mediaKeys(value.ids);
    if (!keys.length) return "";
    const canonical = mergeAliases(keys, canonicalForKeys(keys));
    if (!media.has(canonical)) media.set(canonical, { type, media: clone(value) });
    return canonical;
  }

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.movie) indexMedia(value.movie, "movie");
    if (value.show) {
      const showCanonical = indexMedia(value.show, "show");
      if (value.episode) {
        const season = Number(value.episode.season);
        const episode = Number(value.episode.number);
        if (showCanonical && Number.isInteger(season) && Number.isInteger(episode)) {
          const key = `${showCanonical}|s${season}e${episode}`;
          if (!episodes.has(key)) episodes.set(key, clone(value.episode));
        }
      }
    }
    for (const child of Object.values(value)) visit(child);
  }

  for (const value of parsedFiles.values()) visit(value);

  return {
    aliases,
    media,
    episodes,
    canonicalContentId(contentId) {
      const raw = rawContentKey(contentId);
      return aliases.get(raw) || raw;
    },
    canonicalMedia(value) {
      const keys = mediaKeys(value?.ids);
      for (const key of keys) {
        const canonical = aliases.get(key);
        if (canonical) return canonical;
      }
      return keys[0] || "";
    },
  };
}

function libraryByContentId(library, mediaIndex) {
  const index = new Map();
  for (const item of asArray(library)) {
    const key = mediaIndex.canonicalContentId(item?.content_id);
    if (key) index.set(key, item);
  }
  return index;
}

function resolveMedia(item, type, mediaIndex, libraryIndex) {
  const key = mediaIndex.canonicalContentId(item?.content_id);
  const indexed = mediaIndex.media.get(key);
  if (indexed?.media) return clone(indexed.media);

  const libraryItem = libraryIndex.get(key);
  const title = libraryItem?.name || item?.title || item?.name || String(item?.content_id || "Unknown title");
  const raw = libraryItem?.release_info ?? libraryItem?.year ?? item?.release_info ?? item?.year ?? "";
  const yearMatch = String(raw).match(/\b(19|20)\d{2}\b/);
  const ids = idsFromContentId(item?.content_id || libraryItem?.content_id);
  const media = { title, ids };
  if (yearMatch) media.year = Number(yearMatch[0]);
  return media;
}

function resolveEpisode(item, show, mediaIndex) {
  const showKey = mediaIndex.canonicalMedia(show) || mediaIndex.canonicalContentId(item?.content_id);
  const season = Number(item?.season);
  const episode = Number(item?.episode);
  const indexed = mediaIndex.episodes.get(`${showKey}|s${season}e${episode}`);
  if (indexed) return clone(indexed);
  return { season, number: episode };
}

function findPathByBasename(textFiles, wanted) {
  const lower = wanted.toLowerCase();
  for (const path of textFiles.keys()) {
    if (basename(path)?.toLowerCase() === lower) return path;
  }
  return null;
}

function numberedPaths(textFiles, prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}-(\\d+)\\.json$`, "i");
  return [...textFiles.keys()]
    .map((path) => ({ path, match: basename(path)?.match(pattern) }))
    .filter((entry) => entry.match)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));
}

function parseRelevantJson(textFiles, path, fallback = []) {
  if (!path || !textFiles.has(path)) return clone(fallback);
  try {
    return JSON.parse(textFiles.get(path));
  } catch (error) {
    throw new Error(`Cannot safely merge ${basename(path)} because it is not valid JSON: ${error.message || error}`);
  }
}

function parseAllJson(textFiles) {
  const parsed = new Map();
  for (const [path, text] of textFiles) {
    if (!/\.json$/i.test(path)) continue;
    try {
      parsed.set(path, JSON.parse(text));
    } catch {
      // Unrelated malformed files are preserved byte-for-byte by the ZIP writer.
    }
  }
  return parsed;
}

function ensureArray(value, filename) {
  if (!Array.isArray(value)) throw new Error(`${filename} is not an array, so it cannot be merged safely.`);
  return value;
}

function watchedIdentityFromNuvio(item, mediaIndex) {
  const base = mediaIndex.canonicalContentId(item?.content_id);
  const season = item?.season == null ? null : Number(item.season);
  const episode = item?.episode == null ? null : Number(item.episode);
  if (Number.isInteger(season) && Number.isInteger(episode)) return `${base}|s${season}e${episode}`;
  return `${base}|movie`;
}

function watchedIdentityFromHistory(entry, mediaIndex) {
  if (entry?.type === "episode" && entry.show && entry.episode) {
    const base = mediaIndex.canonicalMedia(entry.show);
    const season = Number(entry.episode.season);
    const episode = Number(entry.episode.number);
    if (base && Number.isInteger(season) && Number.isInteger(episode)) return `${base}|s${season}e${episode}`;
  }
  if (entry?.movie) {
    const base = mediaIndex.canonicalMedia(entry.movie);
    if (base) return `${base}|movie`;
  }
  return "";
}

function maxHistoryTimestamp(history, movieSummaries, mediaIndex) {
  const latest = new Map();
  for (const entry of history) {
    const key = watchedIdentityFromHistory(entry, mediaIndex);
    if (!key) continue;
    latest.set(key, Math.max(latest.get(key) || 0, parseTimestamp(entry.watched_at)));
  }
  for (const entry of movieSummaries) {
    const base = mediaIndex.canonicalMedia(entry?.movie);
    const key = base ? `${base}|movie` : "";
    if (!key) continue;
    latest.set(key, Math.max(latest.get(key) || 0, parseTimestamp(entry.last_watched_at || entry.last_updated_at)));
  }
  return latest;
}

function latestPlaybackMap(playback, mediaIndex) {
  const map = new Map();
  for (const entry of playback) {
    const key = watchedIdentityFromHistory(entry, mediaIndex);
    if (!key) continue;
    const current = map.get(key);
    if (!current || parseTimestamp(entry.paused_at) >= parseTimestamp(current.paused_at)) map.set(key, entry);
  }
  return map;
}

function makeWatchlistEntry(item, mediaIndex, libraryIndex) {
  const type = String(item?.content_type || "").toLowerCase() === "movie" ? "movie" : "show";
  const media = resolveMedia(item, type, mediaIndex, libraryIndex);
  return type === "movie"
    ? { type: "movie", movie: media, listed_at: toIso(item?.added_at) }
    : { type: "show", show: media, listed_at: toIso(item?.added_at) };
}

function watchlistIdentity(entry, mediaIndex) {
  if (entry?.type === "movie" && entry.movie) {
    const key = mediaIndex.canonicalMedia(entry.movie);
    return key ? `${key}|movie` : "";
  }
  if ((entry?.type === "show" || entry?.type === "series") && entry.show) {
    const key = mediaIndex.canonicalMedia(entry.show);
    return key ? `${key}|show` : "";
  }
  return "";
}

function libraryIdentity(item, mediaIndex) {
  const key = mediaIndex.canonicalContentId(item?.content_id);
  const type = String(item?.content_type || "").toLowerCase() === "movie" ? "movie" : "show";
  return key ? `${key}|${type}` : "";
}

function makeHistoryEntry(item, mediaIndex, libraryIndex) {
  const watchedAt = toIso(item?.watched_at);
  const season = item?.season == null ? null : Number(item.season);
  const episode = item?.episode == null ? null : Number(item.episode);
  if (Number.isInteger(season) && Number.isInteger(episode)) {
    const show = resolveMedia(item, "show", mediaIndex, libraryIndex);
    return {
      type: "episode",
      show,
      episode: resolveEpisode(item, show, mediaIndex),
      watched_at: watchedAt,
    };
  }
  return {
    type: "movie",
    movie: resolveMedia(item, "movie", mediaIndex, libraryIndex),
    watched_at: watchedAt,
  };
}

function makePlaybackEntry(item, mediaIndex, libraryIndex) {
  const duration = Number(item?.duration || 0);
  const position = Number(item?.position || 0);
  if (!(duration > 0) || !(position > 0)) return null;
  const progress = Math.max(0, Math.min(99.999, position / duration * 100));
  const season = item?.season == null ? null : Number(item.season);
  const episode = item?.episode == null ? null : Number(item.episode);
  if (Number.isInteger(season) && Number.isInteger(episode)) {
    const show = resolveMedia(item, "show", mediaIndex, libraryIndex);
    return {
      type: "episode",
      show,
      episode: resolveEpisode(item, show, mediaIndex),
      progress: Number(progress.toFixed(4)),
      paused_at: toIso(item?.last_watched),
    };
  }
  return {
    type: "movie",
    movie: resolveMedia(item, "movie", mediaIndex, libraryIndex),
    progress: Number(progress.toFixed(4)),
    paused_at: toIso(item?.last_watched),
  };
}

function updateMovieSummary(summary, historyEntry, watchedAt, mediaIndex) {
  const key = mediaIndex.canonicalMedia(historyEntry.movie);
  const existing = summary.find((entry) => mediaIndex.canonicalMedia(entry?.movie) === key);
  const watchedIso = toIso(watchedAt);
  if (existing) {
    existing.last_watched_at = watchedIso;
    if ("last_updated_at" in existing) existing.last_updated_at = watchedIso;
    if (Number.isFinite(Number(existing.plays))) existing.plays = Number(existing.plays) + 1;
    return existing;
  }
  const created = { plays: 1, last_watched_at: watchedIso, last_updated_at: watchedIso, movie: clone(historyEntry.movie) };
  summary.push(created);
  return created;
}

function updateShowSummary(summary, historyEntry, watchedAt, mediaIndex) {
  const show = historyEntry.show;
  const showKey = mediaIndex.canonicalMedia(show);
  let row = summary.find((entry) => mediaIndex.canonicalMedia(entry?.show) === showKey);
  const watchedIso = toIso(watchedAt);
  if (!row) {
    row = { plays: 0, last_watched_at: watchedIso, last_updated_at: watchedIso, show: clone(show), seasons: [] };
    summary.push(row);
  }
  row.plays = Number(row.plays || 0) + 1;
  if (parseTimestamp(watchedIso) >= parseTimestamp(row.last_watched_at)) row.last_watched_at = watchedIso;
  row.last_updated_at = watchedIso;
  if (!Array.isArray(row.seasons)) row.seasons = [];
  const seasonNumber = Number(historyEntry.episode.season);
  const episodeNumber = Number(historyEntry.episode.number);
  let season = row.seasons.find((entry) => Number(entry.number) === seasonNumber);
  if (!season) {
    season = { number: seasonNumber, episodes: [] };
    row.seasons.push(season);
  }
  if (!Array.isArray(season.episodes)) season.episodes = [];
  let episode = season.episodes.find((entry) => Number(entry.number) === episodeNumber);
  if (!episode) {
    episode = { number: episodeNumber, plays: 0, last_watched_at: watchedIso };
    season.episodes.push(episode);
  }
  episode.plays = Number(episode.plays || 0) + 1;
  episode.last_watched_at = watchedIso;
}

function findMovieSummaryLocation(movieArrays, movie, mediaIndex) {
  const key = mediaIndex.canonicalMedia(movie);
  for (let index = 0; index < movieArrays.length; index++) {
    if (movieArrays[index].some((entry) => mediaIndex.canonicalMedia(entry?.movie) === key)) return index;
  }
  return -1;
}

export function buildMergedTraktExport(textFiles, nuvioData = {}) {
  if (!(textFiles instanceof Map) || textFiles.size === 0) throw new Error("Choose the original Trakt export ZIP first.");
  const library = asArray(nuvioData.library);
  const watchedItems = asArray(nuvioData.watchedItems);
  const watchProgress = asArray(nuvioData.watchProgress);

  const parsedFiles = parseAllJson(textFiles);
  const mediaIndex = buildMediaIndex(parsedFiles);
  const libraryIndex = libraryByContentId(library, mediaIndex);
  const updates = new Map();
  const warnings = [];

  const watchlistPath = findPathByBasename(textFiles, "lists-watchlist.json") || "lists-watchlist.json";
  const watchlist = ensureArray(parseRelevantJson(textFiles, watchlistPath, []), "lists-watchlist.json");
  const watchlistKeys = new Set(watchlist.map((entry) => watchlistIdentity(entry, mediaIndex)).filter(Boolean));
  const originalWatchlist = watchlist.length;
  let watchlistAdded = 0;
  let unresolvedLibrary = 0;
  for (const item of library) {
    const key = libraryIdentity(item, mediaIndex);
    if (!key) {
      unresolvedLibrary++;
      continue;
    }
    if (watchlistKeys.has(key)) continue;
    const entry = makeWatchlistEntry(item, mediaIndex, libraryIndex);
    const entryKey = watchlistIdentity(entry, mediaIndex) || key;
    if (!entryKey) {
      unresolvedLibrary++;
      continue;
    }
    watchlist.push(entry);
    watchlistKeys.add(entryKey);
    watchlistAdded++;
  }
  if (watchlistAdded) updates.set(watchlistPath, JSON.stringify(watchlist, null, 2));

  const historyPaths = numberedPaths(textFiles, "watched-history");
  const historyArrays = historyPaths.map(({ path }) => ensureArray(parseRelevantJson(textFiles, path, []), basename(path)));
  const history = historyArrays.flat();
  const originalHistoryPlays = history.length;
  const targetHistoryPath = historyPaths.at(-1)?.path || "watched-history-1.json";
  const targetHistory = historyPaths.length ? historyArrays.at(-1) : [];

  const moviePaths = numberedPaths(textFiles, "watched-movies");
  const movieArrays = moviePaths.map(({ path }) => ensureArray(parseRelevantJson(textFiles, path, []), basename(path)));
  const movieSummaries = movieArrays.flat();
  const targetMoviePath = moviePaths.at(-1)?.path || "watched-movies-1.json";
  const targetMovieSummary = moviePaths.length ? movieArrays.at(-1) : [];
  const changedMovieSummaryIndexes = new Set();
  let createdMovieSummary = false;

  const showsPath = findPathByBasename(textFiles, "watched-shows.json") || "watched-shows.json";
  const showSummary = ensureArray(parseRelevantJson(textFiles, showsPath, []), "watched-shows.json");
  let showSummaryChanged = false;

  const latestWatched = maxHistoryTimestamp(history, movieSummaries, mediaIndex);
  let watchedAdded = 0;
  let movieWatchedAdded = 0;
  let episodeWatchedAdded = 0;

  for (const item of watchedItems) {
    const identity = watchedIdentityFromNuvio(item, mediaIndex);
    const watchedAt = parseTimestamp(item?.watched_at);
    if (!identity || !(watchedAt > (latestWatched.get(identity) || 0))) continue;

    const entry = makeHistoryEntry(item, mediaIndex, libraryIndex);
    targetHistory.push(entry);
    history.push(entry);
    latestWatched.set(identity, watchedAt);
    watchedAdded++;

    if (entry.type === "movie") {
      const existingIndex = findMovieSummaryLocation(movieArrays, entry.movie, mediaIndex);
      if (existingIndex >= 0) {
        updateMovieSummary(movieArrays[existingIndex], entry, watchedAt, mediaIndex);
        changedMovieSummaryIndexes.add(existingIndex);
      } else {
        updateMovieSummary(targetMovieSummary, entry, watchedAt, mediaIndex);
        if (moviePaths.length) changedMovieSummaryIndexes.add(movieArrays.length - 1);
        else createdMovieSummary = true;
      }
      movieWatchedAdded++;
    } else {
      updateShowSummary(showSummary, entry, watchedAt, mediaIndex);
      showSummaryChanged = true;
      episodeWatchedAdded++;
    }
  }

  if (watchedAdded) updates.set(targetHistoryPath, JSON.stringify(targetHistory, null, 2));
  for (const index of changedMovieSummaryIndexes) {
    updates.set(moviePaths[index].path, JSON.stringify(movieArrays[index], null, 2));
  }
  if (createdMovieSummary) updates.set(targetMoviePath, JSON.stringify(targetMovieSummary, null, 2));
  if (showSummaryChanged) updates.set(showsPath, JSON.stringify(showSummary, null, 2));

  const playbackPath = findPathByBasename(textFiles, "watched-playback.json") || "watched-playback.json";
  const playback = ensureArray(parseRelevantJson(textFiles, playbackPath, []), "watched-playback.json");
  const playbackByKey = latestPlaybackMap(playback, mediaIndex);
  let playbackAdded = 0;
  let playbackUpdated = 0;
  let playbackRemovedBecauseFinished = 0;
  let playbackSkipped = 0;

  for (const item of watchProgress) {
    const key = watchedIdentityFromNuvio(item, mediaIndex);
    if (!key) continue;
    const candidate = makePlaybackEntry(item, mediaIndex, libraryIndex);
    if (!candidate) {
      playbackSkipped++;
      continue;
    }
    const pausedAt = parseTimestamp(candidate.paused_at);
    const watchedAt = latestWatched.get(key) || 0;
    if (watchedAt >= pausedAt) continue;
    const existing = playbackByKey.get(key);
    if (!existing) {
      playbackByKey.set(key, candidate);
      playbackAdded++;
    } else if (pausedAt > parseTimestamp(existing.paused_at)) {
      playbackByKey.set(key, candidate);
      playbackUpdated++;
    }
  }

  for (const [key, existing] of [...playbackByKey]) {
    const watchedAt = latestWatched.get(key) || 0;
    if (watchedAt > 0 && watchedAt >= parseTimestamp(existing.paused_at)) {
      playbackByKey.delete(key);
      playbackRemovedBecauseFinished++;
    }
  }

  if (playbackAdded || playbackUpdated || playbackRemovedBecauseFinished) {
    const mergedPlayback = [...playbackByKey.values()].sort((a, b) => parseTimestamp(b.paused_at) - parseTimestamp(a.paused_at));
    updates.set(playbackPath, JSON.stringify(mergedPlayback, null, 2));
  }

  if (unresolvedLibrary) warnings.push(`${unresolvedLibrary} Nuvio Library item(s) had no usable content ID and could not be added to the Trakt watchlist.`);
  if (playbackSkipped) warnings.push(`${playbackSkipped} Nuvio progress item(s) had no valid duration/position and were left unchanged.`);

  const preservedFiles = [...textFiles.keys()].filter((path) => !updates.has(path)).length;

  return {
    updates,
    summary: {
      originalWatchlist,
      nuvioLibrary: library.length,
      watchlistAdded,
      finalWatchlist: watchlist.length,
      originalHistoryPlays,
      watchedAdded,
      movieWatchedAdded,
      episodeWatchedAdded,
      finalHistoryPlays: history.length,
      playbackAdded,
      playbackUpdated,
      playbackRemovedBecauseFinished,
      finalPlayback: playbackByKey.size,
      preservedFiles,
    },
    warnings,
  };
}
