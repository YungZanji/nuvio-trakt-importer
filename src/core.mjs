export const IMPORTER_VERSION = "1.2.0";
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

export function newest(items, getTime) {
  return items.reduce((best, item) => !best || getTime(item) > getTime(best) ? item : best, null);
}

function stripPrivateFields(value) {
  if (Array.isArray(value)) return value.map(stripPrivateFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith("_"))
      .map(([key, child]) => [key, stripPrivateFields(child)]),
  );
}

function jsonFile(parsed, candidates) {
  for (const candidate of candidates) {
    if (parsed.has(candidate)) return parsed.get(candidate);
  }
  return [];
}

function idBundle(entry) {
  const ids = entry?.ids ?? entry?.movie?.ids ?? entry?.show?.ids ?? entry?.episode?.ids ?? {};
  return {
    trakt: Number.isFinite(Number(ids.trakt)) ? Number(ids.trakt) : null,
    imdb: typeof ids.imdb === "string" && ids.imdb.trim() ? ids.imdb.trim() : null,
    tmdb: Number.isFinite(Number(ids.tmdb)) ? Number(ids.tmdb) : null,
  };
}

function titleFor(entry, fallback = "Unknown") {
  return entry?.title ?? entry?.movie?.title ?? entry?.show?.title ?? entry?.episode?.title ?? fallback;
}

function libraryFromWatchlist(parsed, problems) {
  const rows = asArray(jsonFile(parsed, ["watchlist.json", "watchlist_movies.json", "watchlist_shows.json"]));
  const results = [];
  for (const entry of rows) {
    const source = entry.movie ?? entry.show ?? entry;
    const ids = idBundle(source);
    const contentId = normalizeContentId(ids);
    if (!contentId) {
      problems.push({ category: "library", title: titleFor(source), reason: "No IMDb/TMDB/Trakt content ID" });
      continue;
    }
    const type = entry.show || source.type === "show" || source.type === "series" ? "series" : "movie";
    results.push({
      content_id: contentId,
      content_type: type,
      name: titleFor(source),
      poster: null,
      poster_shape: "POSTER",
      background: null,
      description: null,
      release_info: String(source.year ?? "") || null,
      imdb_rating: null,
      genres: [],
      addon_base_url: null,
      added_at: parseTimestamp(entry.listed_at ?? entry.created_at) || Date.now(),
      _ids: ids,
      _source: "Trakt watchlist",
    });
  }
  return dedupeLibrary(results);
}

function dedupeLibrary(items) {
  const map = new Map();
  for (const item of items) map.set(`${item.content_type}|${item.content_id}`, item);
  return [...map.values()];
}

function historyRows(parsed) {
  const all = [];
  for (const [name, value] of parsed.entries()) {
    if (!name.toLowerCase().includes("history")) continue;
    if (Array.isArray(value)) all.push(...value);
  }
  return all;
}

function watchedFromHistory(parsed, problems) {
  const map = new Map();
  for (const entry of historyRows(parsed)) {
    const isEpisode = Boolean(entry.episode);
    const parent = isEpisode ? entry.show : (entry.movie ?? entry);
    const ids = idBundle(parent);
    const contentId = normalizeContentId(ids);
    if (!contentId) {
      problems.push({ category: "watched", title: titleFor(parent), reason: "No stable show/movie ID" });
      continue;
    }
    const season = isEpisode ? Number(entry.episode?.season) : null;
    const episode = isEpisode ? Number(entry.episode?.number) : null;
    if (isEpisode && (!Number.isInteger(season) || !Number.isInteger(episode))) {
      problems.push({ category: "watched", title: titleFor(entry.episode), reason: "Episode is missing season/episode coordinates" });
      continue;
    }
    const item = {
      content_id: contentId,
      content_type: isEpisode ? "series" : "movie",
      title: titleFor(parent),
      season,
      episode,
      watched_at: parseTimestamp(entry.watched_at ?? entry.last_watched_at ?? entry.updated_at) || Date.now(),
      _ids: ids,
    };
    const key = `${contentId}|${season ?? ""}|${episode ?? ""}`;
    if (!map.has(key) || item.watched_at > map.get(key).watched_at) map.set(key, item);
  }
  return [...map.values()];
}

function playbackRows(parsed) {
  const all = [];
  for (const [name, value] of parsed.entries()) {
    const lower = name.toLowerCase();
    if (!lower.includes("playback") && !lower.includes("progress")) continue;
    if (Array.isArray(value)) all.push(...value);
  }
  return all;
}

function progressFromPlayback(parsed, problems) {
  const map = new Map();
  for (const entry of playbackRows(parsed)) {
    const isEpisode = Boolean(entry.episode);
    const parent = isEpisode ? entry.show : (entry.movie ?? entry);
    const ids = idBundle(parent);
    const contentId = normalizeContentId(ids);
    const percent = Number(entry.progress ?? entry.percent ?? entry.percentage);
    if (!contentId || !Number.isFinite(percent) || percent <= 0 || percent >= 100) continue;
    const season = isEpisode ? Number(entry.episode?.season) : null;
    const episode = isEpisode ? Number(entry.episode?.number) : null;
    if (isEpisode && (!Number.isInteger(season) || !Number.isInteger(episode))) {
      problems.push({ category: "progress", title: titleFor(entry.episode), reason: "Episode is missing season/episode coordinates" });
      continue;
    }
    const item = {
      content_id: contentId,
      content_type: isEpisode ? "series" : "movie",
      video_id: isEpisode ? `${contentId}:${season}:${episode}` : contentId,
      season,
      episode,
      position: 0,
      duration: 0,
      last_watched: parseTimestamp(entry.paused_at ?? entry.updated_at ?? entry.last_watched_at) || Date.now(),
      progress_key: isEpisode ? `${contentId}_s${season}e${episode}` : contentId,
      _percent: percent,
      _ids: ids,
      _name: isEpisode ? `${titleFor(parent)} S${season}E${episode}` : titleFor(parent),
    };
    const key = item.progress_key;
    if (!map.has(key) || item.last_watched > map.get(key).last_watched) map.set(key, item);
  }
  return [...map.values()];
}

function countRatings(parsed) {
  let count = 0;
  for (const [name, value] of parsed.entries()) {
    if (name.toLowerCase().includes("rating") && Array.isArray(value)) count += value.length;
  }
  return count;
}

function countLists(parsed) {
  let count = 0;
  for (const [name, value] of parsed.entries()) {
    if (name.toLowerCase().includes("list") && Array.isArray(value) && !name.toLowerCase().includes("watchlist")) count += value.length;
  }
  return count;
}

export function buildPlan(textFiles) {
  const { parsed, errors } = parseJsonFiles(textFiles);
  const problems = [];
  const library = libraryFromWatchlist(parsed, problems);
  const watchedItems = watchedFromHistory(parsed, problems);
  const progress = progressFromPlayback(parsed, problems);
  return {
    library,
    watchedItems,
    progress,
    missingIds: problems,
    parseErrors: errors,
    sourceSummary: {
      filesParsed: parsed.size,
      historyPlaysRead: historyRows(parsed).length,
      ratingsRetainedInZip: countRatings(parsed),
      listsRetainedInZip: countLists(parsed),
    },
    unsupported: {
      ratings: countRatings(parsed),
      lists: countLists(parsed),
    },
  };
}

export function mergeLibrary(existing, imported) {
  const merged = new Map();
  for (const item of existing) merged.set(`${item.content_type}|${item.content_id}`, stripPrivateFields(item));
  for (const item of imported) merged.set(`${item.content_type}|${item.content_id}`, stripPrivateFields(item));
  return [...merged.values()];
}

function chooseNewer(existing, imported, timestampKey) {
  if (!existing) return stripPrivateFields(imported);
  const existingTime = Number(existing[timestampKey] ?? 0);
  const importedTime = Number(imported[timestampKey] ?? 0);
  return importedTime > existingTime ? stripPrivateFields(imported) : stripPrivateFields(existing);
}

export function mergeWatched(existing, imported) {
  const merged = new Map();
  for (const item of existing) {
    const key = `${item.content_id}|${item.season ?? ""}|${item.episode ?? ""}`;
    merged.set(key, stripPrivateFields(item));
  }
  for (const item of imported) {
    const key = `${item.content_id}|${item.season ?? ""}|${item.episode ?? ""}`;
    merged.set(key, chooseNewer(merged.get(key), stripPrivateFields(imported), "watched_at"));
  }
  return [...merged.values()];
}

export function mergeProgress(existing, imported) {
  const merged = new Map();
  for (const item of existing) {
    const key = item.progress_key || (item.season != null && item.episode != null
      ? `${item.content_id}_s${item.season}e${item.episode}`
      : item.content_id);
    merged.set(key, stripPrivateFields(item));
  }
  for (const item of imported) {
    const key = imported.progress_key || (imported.season != null && imported.episode != null
      ? `${imported.content_id}_s${imported.season}e${imported.episode}`
      : imported.content_id);
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
