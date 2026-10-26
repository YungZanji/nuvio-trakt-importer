// Trakt's web JSON importer expects flat rows, not the nested GDPR-export ZIP.
// In particular, a show ID is NEVER a valid substitute for an episode ID.
const hasId = (value) => value !== undefined && value !== null && String(value).trim() !== "";

function typedId(ids, type) {
  if (!ids || typeof ids !== "object") return null;
  const ordered = type === "episode"
    ? ["trakt", "tmdb", "imdb", "tvdb"]
    : type === "movie" ? ["imdb", "tmdb", "trakt"] : ["imdb", "tmdb", "trakt", "tvdb"];
  for (const name of ordered) {
    const value = ids[name];
    if (!hasId(value)) continue;
    const text = String(value).trim();
    if (name === "imdb" && !/^tt\d+$/i.test(text)) continue;
    if (name !== "imdb" && !/^\d+$/.test(text)) continue;
    return { [name + "_id"]: text };
  }
  return null;
}

function keysForShow(show, season, episode) {
  const ids = show?.ids || {};
  const suffix = "|s" + Number(season) + "e" + Number(episode);
  return ["imdb", "tmdb", "trakt", "tvdb"]
    .filter((service) => hasId(ids[service]))
    .map((service) => service + ":" + String(ids[service]).trim().toLowerCase() + suffix);
}

function validDate(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function relevantArray(textFiles, basename, updates = new Map()) {
  const matching = [...new Set([...textFiles.keys(), ...updates.keys()])]
    .filter((path) => path.split("/").at(-1).toLowerCase() === basename.toLowerCase());
  return matching.flatMap((path) => {
    const text = updates.get(path) ?? textFiles.get(path);
    try {
      const value = JSON.parse(text);
      if (!Array.isArray(value)) throw new Error("not an array");
      return value;
    } catch (error) {
      throw new Error("Cannot parse " + path + " as an array: " + error.message);
    }
  });
}

function relevantHistory(textFiles, updates = new Map()) {
  const paths = [...new Set([...textFiles.keys(), ...updates.keys()])]
    .filter((path) => /^watched-history-\d+\.json$/i.test(path.split("/").at(-1)))
    .sort((a, b) => Number(a.split("/").at(-1).match(/\d+/)?.[0] || 0) - Number(b.split("/").at(-1).match(/\d+/)?.[0] || 0));
  return paths.flatMap((path) => {
    try {
      const values = JSON.parse(updates.get(path) ?? textFiles.get(path));
      if (!Array.isArray(values)) throw new Error("not an array");
      return values;
    } catch (error) {
      throw new Error("Cannot parse " + path + ": " + error.message);
    }
  });
}

function episodeIndexFor(history) {
  const map = new Map();
  for (const entry of history) {
    if (entry?.type !== "episode" || !entry.show || !entry.episode) continue;
    const id = typedId(entry.episode.ids, "episode");
    if (!id) continue;
    for (const key of keysForShow(entry.show, entry.episode.season, entry.episode.number)) {
      map.set(key, id);
    }
  }
  return map;
}

/** Reuse episode-level IDs from the historical Trakt ZIP for paused episodes too. */
export function buildTraktEpisodeIdIndex(textFiles) {
  if (!(textFiles instanceof Map)) return new Map();
  const index = episodeIndexFor(relevantHistory(textFiles));
  const output = new Map();
  for (const [key, typed] of index) {
    const [field, value] = Object.entries(typed)[0] || [];
    if (!field || !field.endsWith("_id")) continue;
    const service = field.slice(0, -3);
    output.set(key, { [service]: service === "imdb" ? value : Number(value) });
  }
  return output;
}

function insertEpisodeIds(index, map) {
  for (const [key, ids] of map || []) {
    const id = typedId(ids, "episode");
    if (id) index.set(String(key).toLowerCase(), id);
  }
}

function showImdbIds(textFiles, mergeResult) {
  const imdb = new Set();
  const inputs = [
    ...relevantHistory(textFiles, mergeResult.updates),
    ...relevantArray(textFiles, "lists-watchlist.json", mergeResult.updates),
    ...mergeResult.changes.history.map((row) => row.entry),
    ...mergeResult.changes.watchlist.map((row) => row.entry),
  ];
  for (const entry of inputs) {
    const id = entry?.show?.ids?.imdb;
    if (typeof id === "string" && /^tt\d+$/i.test(id)) imdb.add(id.toLowerCase());
  }
  return imdb;
}

function formatEntry(entry, kind, episodeIndex) {
  const type = entry?.type === "episode" ? "episode" : entry?.movie ? "movie" : "show";
  const media = entry?.movie || entry?.show;
  if (!media) return { error: "Missing movie/show metadata" };
  let id;
  if (type === "episode") {
    id = typedId(entry.episode?.ids, "episode");
    if (!id) {
      for (const key of keysForShow(entry.show, entry.episode?.season, entry.episode?.number)) {
        id = episodeIndex.get(key);
        if (id) break;
      }
    }
    if (!id) return { error: "Episode-specific ID required", type };
  } else id = typedId(media.ids, type);
  if (!id) return { error: "No valid identifier", type };
  const timestamp = validDate(kind === "watchlist" ? entry.listed_at : entry.watched_at);
  if (!timestamp) return { error: "Invalid " + (kind === "watchlist" ? "watchlist" : "watched") + " timestamp", type };
  return { row: { ...id, type, [kind === "watchlist" ? "watchlisted_at" : "watched_at"]: timestamp } };
}

/**
 * Produce exact Trakt web importer schema: [{imdb_id|tmdb_id|trakt_id|tvdb_id, type, watched_at|watchlisted_at}].
 * Scope "new" exports only user-selected Nuvio changes. "all" includes preserved Trakt history and watchlist.
 * NO progress rows; Trakt's file-import schema has no Continue Watching fields.
 * An unresolvable episode is reported rather than silently using the parent show's ID.
 */
export function buildTraktImportJson(textFiles, mergeResult, {
  scope = "new", excluded = new Set(), episodeIds = new Map(),
} = {}) {
  if (!(textFiles instanceof Map)) throw new Error("Missing original Trakt archive.");
  if (!mergeResult?.updates || !mergeResult?.changes) throw new Error("Merge the Trakt archive first.");
  if (!["new", "all"].includes(scope)) throw new Error("Unknown import scope.");
  const index = episodeIndexFor(relevantHistory(textFiles));
  const showIds = showImdbIds(textFiles, mergeResult);
  insertEpisodeIds(index, episodeIds);
  const rows = [];
  const unresolved = [];
  const selected = (changes) => changes.filter((change) => !excluded.has(change.id)).map((change) => ({
    entry: change.entry, changeId: change.id,
  }));
  const history = scope === "all"
    ? relevantHistory(textFiles, mergeResult.updates).map((entry) => ({ entry, changeId: null }))
    : selected(mergeResult.changes.history);
  const watchlist = scope === "all"
    ? relevantArray(textFiles, "lists-watchlist.json", mergeResult.updates).map((entry) => ({ entry, changeId: null }))
    : selected(mergeResult.changes.watchlist);
  for (const [kind, entries] of [["history", history], ["watchlist", watchlist]]) {
    for (const { entry, changeId } of entries) {
      const movieImdb = entry?.movie?.ids?.imdb;
      const conflicting = typeof movieImdb === "string" && showIds.has(movieImdb.toLowerCase());
      const converted = conflicting
        ? { error:"Movie/show identifier conflict" }
        : formatEntry(entry, kind, index);
      if (converted.row) rows.push(converted.row);
      else unresolved.push({
        changeId, kind, reason: converted.error,
        title: String(entry?.show?.title || entry?.movie?.title || "Unknown title"),
        showIds: entry?.show?.ids || null,
        season: entry?.episode?.season ?? null,
        episode: entry?.episode?.number ?? null,
      });
    }
  }
  return {
    rows,
    unresolved,
    summary: {
      watchlist: rows.filter((row) => hasId(row.watchlisted_at)).length,
      history: rows.filter((row) => hasId(row.watched_at)).length,
      episodes: rows.filter((row) => row.type === "episode").length,
      unresolved: unresolved.length,
    },
  };
}
