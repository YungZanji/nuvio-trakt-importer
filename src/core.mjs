export const IMPORTER_VERSION = "1.1.0";
export const NUVIO_REPO_COMMIT = "a4e0c71678dc8364a4bf2175e8fa96c641da41d9";
export const NUVIO_PUBLIC_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI";

const asArray = (value) => Array.isArray(value) ? value : [];

export function parseJsonFiles(textFiles) {
  const parsed = new Map();
  const errors = [];

  for (const [rawName, text] of textFiles.entries()) {
    const name = rawName.split("/").pop();
    if (!name?.toLowerCase().endsWith(".json")) continue;
    try {
      parsed.set(name, JSON.parse(text));
    } catch (error) {
      errors.push({ file: name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { parsed, errors };
}

export function normalizeContentId(ids = {}) {
  const imdb = typeof ids.imdb === "string" ? ids.imdb.trim() : "";
  if (imdb) return imdb;
  if (Number.isFinite(Number(ids.tmdb))) return `tmdb:${Number(ids.tmdb)}`;
  if (Number.isFinite(Number(ids.trakt))) return `trakt:${Number(ids.trakt)}`;
  return "";
}

export function parseTimestamp(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : 0;
}

export function mediaIdentity(item) {
  if (!item || typeof item !== "object") return null;
  if (item.type === "movie" && item.movie) {
    return {
      type: "movie",
      contentType: "movie",
      media: item.movie,
      ids: item.movie.ids ?? {},
      title: item.movie.title || "Untitled movie",
      year: item.movie.year ?? null,
    };
  }
  if ((item.type === "show" || item.type === "series") && item.show) {
    return {
      type: "show",
      contentType: "series",
      media: item.show,
      ids: item.show.ids ?? {},
      title: item.show.title || "Untitled series",
      year: item.show.year ?? null,
    };
  }
  return null;
}

function chooseNewer(existing, candidate, field) {
  if (!existing) return candidate;
  return Number(candidate[field] ?? 0) > Number(existing[field] ?? 0) ? candidate : existing;
}

function libraryKey(item) {
  return `${String(item.content_type).toLowerCase()}|${item.content_id}`;
}

function watchedKey(item) {
  return `${item.content_id}|${item.season ?? ""}|${item.episode ?? ""}`;
}

function progressKey(item) {
  return item.progress_key || (item.season != null && item.episode != null
    ? `${item.content_id}_s${item.season}e${item.episode}`
    : item.content_id);
}

function mapLibraryItem(item, missingIds) {
  const identity = mediaIdentity(item);
  if (!identity) return null;
  const contentId = normalizeContentId(identity.ids);
  if (!contentId) {
    missingIds.push({ category: "watchlist", title: identity.title, year: identity.year });
    return null;
  }
  return {
    content_id: contentId,
    content_type: identity.contentType,
    name: identity.title,
    poster: null,
    poster_shape: "POSTER",
    background: null,
    description: null,
    release_info: identity.year != null ? String(identity.year) : null,
    imdb_rating: null,
    genres: [],
    addon_base_url: null,
    added_at: parseTimestamp(item.listed_at),
    _ids: identity.ids,
  };
}

function mapWatchedMovie(entry, missingIds) {
  const movie = entry?.movie;
  if (!movie) return null;
  const contentId = normalizeContentId(movie.ids ?? {});
  if (!contentId) {
    missingIds.push({ category: "watched_movie", title: movie.title, year: movie.year });
    return null;
  }
  return {
    content_id: contentId,
    content_type: "movie",
    title: movie.title || contentId,
    season: null,
    episode: null,
    watched_at: parseTimestamp(entry.last_watched_at || entry.last_updated_at),
  };
}

function mapWatchedEpisode(entry, missingIds) {
  if (entry?.type !== "episode" || !entry.episode || !entry.show) return null;
  const season = Number(entry.episode.season);
  const episode = Number(entry.episode.number);
  if (!Number.isInteger(season) || !Number.isInteger(episode)) return null;
  const contentId = normalizeContentId(entry.show.ids ?? {});
  if (!contentId) {
    missingIds.push({
      category: "watched_episode",
      title: entry.show.title,
      year: entry.show.year,
      season,
      episode,
    });
    return null;
  }
  return {
    content_id: contentId,
    content_type: "series",
    title: entry.show.title || contentId,
    season,
    episode,
    watched_at: parseTimestamp(entry.watched_at),
  };
}

function mapPlaybackItem(entry, missingIds) {
  const identity = entry?.type === "episode"
    ? mediaIdentity({ type: "show", show: entry.show })
    : mediaIdentity({ type: "movie", movie: entry.movie });
  if (!identity) return null;
  const contentId = normalizeContentId(identity.ids);
  if (!contentId) {
    missingIds.push({ category: "playback", title: identity.title, year: identity.year });
    return null;
  }
  const percent = Number(entry.progress);
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return null;
  const season = entry.type === "episode" ? Number(entry.episode?.season) : null;
  const episode = entry.type === "episode" ? Number(entry.episode?.number) : null;
  if (entry.type === "episode" && (!Number.isInteger(season) || !Number.isInteger(episode))) return null;
  const videoId = entry.type === "episode" ? `${contentId}:${season}:${episode}` : contentId;
  return {
    content_id: contentId,
    content_type: identity.contentType,
    video_id: videoId,
    season,
    episode,
    position: 0,
    duration: 0,
    last_watched: parseTimestamp(entry.paused_at),
    progress_key: entry.type === "episode" ? `${contentId}_s${season}e${episode}` : contentId,
    _progress_percent: Math.max(0, Math.min(100, percent)),
    _name: identity.title,
    _year: identity.year,
    _ids: identity.ids,
    _episode_title: entry.episode?.title ?? null,
  };
}

function listFiles(parsed, regex) {
  return [...parsed.entries()]
    .filter(([name]) => regex.test(name))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .flatMap(([, value]) => asArray(value));
}

function countUnsupported(parsed) {
  const ratingFiles = ["ratings-movies.json", "ratings-shows.json", "ratings-seasons.json", "ratings-episodes.json"];
  const socialPrefixes = /^(comments-|likes-|notes-|network-|hidden-)/;
  const personalListItemFiles = [...parsed.keys()].filter((name) => /^lists-list-.*\.json$/i.test(name));
  const personalListDefinitions = asArray(parsed.get("lists-lists.json"));
  return {
    ratings: ratingFiles.reduce((sum, name) => sum + asArray(parsed.get(name)).length, 0),
    personalLists: personalListDefinitions.length,
    personalListItems: personalListItemFiles.reduce((sum, name) => sum + asArray(parsed.get(name)).length, 0),
    socialAndPreferenceRecords: [...parsed.entries()]
      .filter(([name]) => socialPrefixes.test(name))
      .reduce((sum, [, value]) => sum + (Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0), 0),
  };
}

export function buildImportPlan(textFiles) {
  const { parsed, errors } = parseJsonFiles(textFiles);
  const missingIds = [];

  const watchlistMap = new Map();
  for (const item of asArray(parsed.get("lists-watchlist.json"))) {
    const mapped = mapLibraryItem(item, missingIds);
    if (mapped) watchlistMap.set(libraryKey(mapped), mapped);
  }

  const watchedMap = new Map();
  for (const entry of listFiles(parsed, /^watched-movies-\d+\.json$/i)) {
    const mapped = mapWatchedMovie(entry, missingIds);
    if (mapped) watchedMap.set(watchedKey(mapped), chooseNewer(watchedMap.get(watchedKey(mapped)), mapped, "watched_at"));
  }
  for (const entry of listFiles(parsed, /^watched-history-\d+\.json$/i)) {
    const mapped = mapWatchedEpisode(entry, missingIds);
    if (mapped) watchedMap.set(watchedKey(mapped), chooseNewer(watchedMap.get(watchedKey(mapped)), mapped, "watched_at"));
  }

  const playbackMap = new Map();
  for (const entry of asArray(parsed.get("watched-playback.json"))) {
    const mapped = mapPlaybackItem(entry, missingIds);
    if (mapped) playbackMap.set(progressKey(mapped), chooseNewer(playbackMap.get(progressKey(mapped)), mapped, "last_watched"));
  }

  const watchedHistory = listFiles(parsed, /^watched-history-\d+\.json$/i);
  const stats = parsed.get("user-stats.json") ?? null;
  const sourceProfile = parsed.get("user-profile.json") ?? null;
  const lowProgress = [...playbackMap.values()].filter((item) => item._progress_percent < 2);

  return {
    version: IMPORTER_VERSION,
    sourceFiles: [...parsed.keys()].sort(),
    parseErrors: errors,
    library: [...watchlistMap.values()].sort((a, b) => b.added_at - a.added_at),
    watchedItems: [...watchedMap.values()].sort((a, b) => b.watched_at - a.watched_at),
    progress: [...playbackMap.values()].sort((a, b) => b.last_watched - a.last_watched),
    missingIds,
    unsupported: countUnsupported(parsed),
    sourceSummary: {
      jsonFiles: parsed.size,
      historyPlays: watchedHistory.length,
      watchlistEntries: asArray(parsed.get("lists-watchlist.json")).length,
      playbackEntries: asArray(parsed.get("watched-playback.json")).length,
      watchedMovieRows: listFiles(parsed, /^watched-movies-\d+\.json$/i).length,
      watchedShowRows: asArray(parsed.get("watched-shows.json")).length,
      lowProgressEntries: lowProgress.length,
      stats,
      sourceProfilePresent: sourceProfile != null,
    },
  };
}

export function parseRuntimeMinutes(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  const hours = Number(raw.match(/(\d+(?:\.\d+)?)\s*h/)?.[1] ?? 0);
  const minutesMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:min|m\b)/);
  const minutes = Number(minutesMatch?.[1] ?? 0);
  const total = hours * 60 + minutes;
  if (total > 0) return total;
  const numeric = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function applyRuntime(progressItem, runtimeMinutes) {
  const minutes = parseRuntimeMinutes(runtimeMinutes);
  if (!minutes) return { ...progressItem, position: 0, duration: 0 };
  const duration = Math.round(minutes * 60_000);
  const position = Math.max(1, Math.min(duration - 1, Math.round(duration * progressItem._progress_percent / 100)));
  return { ...progressItem, position, duration };
}

export function stripPrivateFields(value) {
  if (Array.isArray(value)) return value.map(stripPrivateFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, child]) => [key, stripPrivateFields(child)]));
}

export function mergeLibrary(remoteItems, importedItems) {
  const merged = new Map();
  for (const item of remoteItems) merged.set(libraryKey(item), item);
  for (const imported of importedItems) {
    const key = libraryKey(imported);
    const remote = merged.get(key);
    if (!remote) {
      merged.set(key, stripPrivateFields(imported));
      continue;
    }
    merged.set(key, {
      ...stripPrivateFields(imported),
      ...remote,
      name: remote.name || imported.name,
      poster: remote.poster || imported.poster,
      background: remote.background || imported.background,
      description: remote.description || imported.description,
      release_info: remote.release_info || imported.release_info,
      imdb_rating: remote.imdb_rating ?? imported.imdb_rating,
      genres: Array.isArray(remote.genres) && remote.genres.length ? remote.genres : imported.genres,
      added_at: Math.min(Number(remote.added_at || Infinity), Number(imported.added_at || Infinity)),
    });
  }
  return [...merged.values()];
}

export function mergeWatchedItems(remoteItems, importedItems) {
  const merged = new Map();
  for (const item of remoteItems) merged.set(watchedKey(item), item);
  for (const imported of importedItems) {
    const key = watchedKey(imported);
    merged.set(key, chooseNewer(merged.get(key), stripPrivateFields(imported), "watched_at"));
  }
  return [...merged.values()];
}

export function mergeProgress(remoteItems, importedItems) {
  const merged = new Map();
  for (const item of remoteItems) merged.set(progressKey(item), item);
  for (const imported of importedItems) {
    const key = progressKey(imported);
    merged.set(key, chooseNewer(merged.get(key), stripPrivateFields(imported), "last_watched"));
  }
  return [...merged.values()];
}

export function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export function buildAudit(plan, context = {}) {
  return {
    importerVersion: IMPORTER_VERSION,
    nuvioRepositoryCommit: NUVIO_REPO_COMMIT,
    generatedAt: new Date().toISOString(),
    profile: context.profile ?? null,
    sourceSummary: plan.sourceSummary,
    converted: {
      libraryItems: plan.library.length,
      watchedItems: plan.watchedItems.length,
      movieWatchedItems: plan.watchedItems.filter((item) => item.content_type === "movie").length,
      episodeWatchedItems: plan.watchedItems.filter((item) => item.content_type === "series").length,
      continueWatchingItems: plan.progress.length,
    },
    metadata: context.metadata ?? null,
    remoteBefore: context.remoteBefore ?? null,
    remoteAfter: context.remoteAfter ?? null,
    missingIds: plan.missingIds,
    parseErrors: plan.parseErrors,
    unsupportedByNuvioSync: {
      ...plan.unsupported,
      explanation: "Nuvio Sync has no user-rating, social-history, or separate local personal-list schema. These records remain safely preserved in the original Trakt ZIP and were not flattened into the Nuvio library.",
    },
    notes: [
      "Watched history is deduplicated to Nuvio's watched-state model: one latest timestamp per movie or episode.",
      "Trakt playback percentages are converted to millisecond positions using metadata runtime before upload.",
      "Existing Nuvio Sync data is merged by stable content key; newer progress and watched timestamps win.",
    ],
  };
}
