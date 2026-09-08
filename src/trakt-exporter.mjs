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
  return keys;
}

function contentKey(contentId) {
  const ids = idsFromContentId(contentId);
  return mediaKeys(ids)[0] || String(contentId || "").trim().toLowerCase();
}

function mediaKey(media) {
  return mediaKeys(media?.ids)[0] || "";
}

function watchedIdentityFromNuvio(item) {
  const base = contentKey(item?.content_id);
  const season = item?.season == null ? null : Number(item.season);
  const episode = item?.episode == null ? null : Number(item.episode);
  if (Number.isInteger(season) && Number.isInteger(episode)) return `${base}|s${season}e${episode}`;
  return `${base}|movie`;
}

function watchedIdentityFromHistory(entry) {
  if (entry?.type === "episode" && entry.show && entry.episode) {
    const base = mediaKey(entry.show);
    const season = Number(entry.episode.season);
    const episode = Number(entry.episode.number);
    if (base && Number.isInteger(season) && Number.isInteger(episode)) return `${base}|s${season}e${episode}`;
  }
  if (entry?.movie) {
    const base = mediaKey(entry.movie);
    if (base) return `${base}|movie`;
  }
  return "";
}

function progressIdentityFromTrakt(entry) {
  return watchedIdentityFromHistory(entry);
}

function yearFromItem(item) {
  const raw = item?.release_info ?? item?.year ?? "";
  const match = String(raw).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function buildMediaIndex(parsedFiles) {
  const media = new Map();
  const episodes = new Map();

  function indexMedia(value, type) {
    if (!value || typeof value !== "object") return;
    for (const key of mediaKeys(value.ids)) {
      if (!media.has(key)) media.set(key, { type, media: clone(value) });
    }
  }

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.movie) indexMedia(value.movie, "movie");
    if (value.show) {
      indexMedia(value.show, "show");
      if (value.episode) {
        const showKey = mediaKey(value.show);
        const season = Number(value.episode.season);
        const episode = Number(value.episode.number);
        if (showKey && Number.isInteger(season) && Number.isInteger(episode)) {
          const key = `${showKey}|s${season}e${episode}`;
          if (!episodes.has(key)) episodes.set(key, clone(value.episode));
        }
      }
    }
    for (const child of Object.values(value)) visit(child);
  }

  for (const value of parsedFiles.values()) visit(value);
  return { media, episodes };
}

function libraryByContentId(library) {
  const index = new Map();
  for (const item of asArray(library)) {
    const key = contentKey(item?.content_id);
    if (key) index.set(key, item);
  }
  return index;
}

function resolveMedia(item, type, mediaIndex, libraryIndex) {
  const key = contentKey(item?.content_id);
  const indexed = mediaIndex.media.get(key);
  if (indexed?.media) return clone(indexed.media);

  const libraryItem = libraryIndex.get(key);
  const title = libraryItem?.name || item?.title || item?.name || String(item?.content_id || "Unknown title");
  const year = yearFromItem(libraryItem || item);
  const ids = idsFromContentId(item?.content_id || libraryItem?.content_id);
  const media = { title, ids };
  if (year) media.year = year;
  return media;
}

function resolveEpisode(item, show, mediaIndex) {
  const showKey = mediaKey(show) || contentKey(item?.content_id);
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
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.json$`, "i");
  return [...textFiles.keys()]
    .map((path) => ({ path, match: basename(path)?.match(pattern) }))
    .filter((entry) => entry.match)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));
}

function parseRelevantJson(textFiles, path, fallback = []) {
  if (!path || !textFiles.has(path)) return clone(fallback);
  try {
    const value = JSON.parse(textFiles.get(path));
    return value;
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
      // Unrelated malformed files are preserved byte-for-byte by the caller.
    }
  }
  return parsed;
}

function ensureArray(value, filename) {
  if (!Array.isArray(value)) throw new Error(`${filename} is not an array, so it cannot be merged safely.`);
  return value;
}

function maxHistoryTimestamp(history, movieSummaries) {
  const latest = new Map();
  for (const entry of history) {
    const key = watchedIdentityFromHistory(entry);
    if (!key) continue;
    latest.set(key, Math.max(latest.get(key) || 0, parseTimestamp(entry.watched_at)));
  }
  for (const entry of movieSummaries) {
    const key = entry?.movie ? `${mediaKey(entry.movie)}|movie` : "";
    if (!key || key.startsWith("|")) continue;
    latest.set(key, Math.max(latest.get(key) || 0, parseTimestamp(entry.last_watched_at || entry.last_updated_at)));
  }
  return latest;
}

function latestPlaybackMap(playback) {
  const map = new Map();
  for (const entry of playback) {
    const key = progressIdentityFromTrakt(entry);
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

function watchlistIdentity(entry) {
  if (entry?.type === "movie" && entry.movie) return `${mediaKey(entry.movie)}|movie`;
  if ((entry?.type === "show" || entry?.type === "series") && entry.show) return `${mediaKey(entry.show)}|show`;
  return "";
}

function libraryIdentity(item) {
  const key = contentKey(item?.content_id);
  const type = String(item?.content_type || "").toLowerCase() === "movie" ? "movie" : "show";
  return `${key}|${type}`;
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

function updateMovieSummary(summary, historyEntry, watchedAt) {
  const key = mediaKey(historyEntry.movie);
  const existing = summary.find((entry) => mediaKey(entry?.movie) === key);
  const watchedIso = toIso(watchedAt);
  if (existing) {
    existing.last_watched_at = watchedIso;
    if ("last_updated_at" in existing) existing.last_updated_at = watchedIso;
    if (Number.isFinite(Number(existing.plays))) existing.plays = Number(existing.plays) + 1;
    return;
  }
  summary.push({ plays: 1, last_watched_at: watchedIso, last_updated_at: watchedIso, movie: clone(historyEntry.movie) });
}

function updateShowSummary(summary, historyEntry, watchedAt) {
  const show = historyEntry.show;
  const showKey = mediaKey(show);
  let row = summary.find((entry) => mediaKey(entry?.show) === showKey);
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

export function buildMergedTraktExport(textFiles, nuvioData = {}) {
  if (!(textFiles instanceof Map) || textFiles.size === 0) throw new Error("Choose the original Trakt export ZIP first.");
  const library = asArray(nuvioData.library);
  const watchedItems = asArray(nuvioData.watchedItems);
  const watchProgress = asArray(nuvioData.watchProgress);

  const parsedFiles = parseAllJson(textFiles);
  const mediaIndex = buildMediaIndex(parsedFiles);
  const libraryIndex = libraryByContentId(library);
  const updates = new Map();
  const warnings = [];

  const watchlistPath = findPathByBasename(textFiles, "lists-watchlist.json") || "lists-watchlist.json";
  const watchlist = ensureArray(parseRelevantJson(textFiles, watchlistPath, []), "lists-watchlist.json");
  const watchlistKeys = new Set(watchlist.map(watchlistIdentity).filter(Boolean));
  let watchlistAdded = 0;
  let unresolvedLibrary = 0;
  for (const item of library) {
    const key = libraryIdentity(item);
    if (!key || key.startsWith("|")) {
      unresolvedLibrary++;
      continue;
    }
    if (watchlistKeys.has(key)) continue;
    const entry = makeWatchlistEntry(item, mediaIndex, libraryIndex);
    const entryKey = watchlistIdentity(entry);
    if (!entryKey || entryKey.startsWith("|")) {
      unresolvedLibrary++;
      continue;
    }
    watchlist.push(entry);
    watchlistKeys.add(entryKey);
    watchlistAdded++;
  }
  updates.set(watchlistPath, JSON.stringify(watchlist, null, 2));

  const historyPaths = numberedPaths(textFiles, "watched-history");
  const historyArrays = historyPaths.map(({ path }) => ensureArray(parseRelevantJson(textFiles, path, []), basename(path)));
  const history = historyArrays.flat();
  const targetHistoryPath = historyPaths.at(-1)?.path || "watched-history-1.json";
  const targetHistory = historyPaths.length ? historyArrays.at(-1) : [];

  const moviePaths = numberedPaths(textFiles, "watched-movies");
  const movieArrays = moviePaths.map(({ path }) => ensureArray(parseRelevantJson(textFiles, path, []), basename(path)));
  const movieSummaries = movieArrays.flat();
  const targetMoviePath = moviePaths.at(-1)?.path || "watched-movies-1.json";
  const targetMovieSummary = moviePaths.length ? movieArrays.at(-1) : [];

  const showsPath = findPathByBasename(textFiles, "watched-shows.json") || "watched-shows.json";
  const showSummary = ensureArray(parseRelevantJson(textFiles, showsPath, []), "watched-shows.json");

  const latestWatched = maxHistoryTimestamp(history, movieSummaries);
  let watchedAdded = 0;
  let movieWatchedAdded = 0;
  let episodeWatchedAdded = 0;
  for (const item of watchedItems) {
    const identity = watchedIdentityFromNuvio(item);
    const watchedAt = parseTimestamp(item?.watched_at);
    if (!identity || identity.startsWith("|")) continue;
    if (!(watchedAt > (latestWatched.get(identity) || 0))) continue;
    const entry = makeHistoryEntry(item, mediaIndex, libraryIndex);
    targetHistory.push(entry);
    history.push(entry);
    latestWatched.set(identity, watchedAt);
    watchedAdded++;
    if (entry.type === "movie") {
      updateMovieSummary(targetMovieSummary, entry, watchedAt);
      movieWatchedAdded++;
    } else {
      updateShowSummary(showSummary, entry, watchedAt);
      episodeWatchedAdded++;
    }
  }
  updates.set(targetHistoryPath, JSON.stringify(targetHistory, null, 2));
  updates.set(targetMoviePath, JSON.stringify(targetMovieSummary, null, 2));
  updates.set(showsPath, JSON.stringify(showSummary, null, 2));

  const playbackPath = findPathByBasename(textFiles, "watched-playback.json") || "watched-playback.json";
  const playback = ensureArray(parseRelevantJson(textFiles, playbackPath, []), "watched-playback.json");
  const playbackByKey = latestPlaybackMap(playback);
  let playbackAdded = 0;
  let playbackUpdated = 0;
  let playbackRemovedBecauseFinished = 0;
  let playbackSkipped = 0;

  for (const item of watchProgress) {
    const key = watchedIdentityFromNuvio(item);
    if (!key || key.startsWith("|")) continue;
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
  updates.set(playbackPath, JSON.stringify([...playbackByKey.values()].sort((a, b) => parseTimestamp(b.paused_at) - parseTimestamp(a.paused_at)), null, 2));

  if (unresolvedLibrary) warnings.push(`${unresolvedLibrary} Nuvio Library item(s) had no usable content ID and could not be added to the Trakt watchlist.`);
  if (playbackSkipped) warnings.push(`${playbackSkipped} Nuvio progress item(s) had no valid duration/position and were left unchanged.`);

  return {
    updates,
    summary: {
      originalWatchlist: watchlist.length - watchlistAdded,
      nuvioLibrary: library.length,
      watchlistAdded,
      finalWatchlist: watchlist.length,
      originalHistoryPlays: history.length - watchedAdded,
      watchedAdded,
      movieWatchedAdded,
      episodeWatchedAdded,
      finalHistoryPlays: history.length,
      playbackAdded,
      playbackUpdated,
      playbackRemovedBecauseFinished,
      finalPlayback: playbackByKey.size,
      preservedFiles: textFiles.size - updates.size,
    },
    warnings,
  };
}
