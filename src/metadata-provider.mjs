const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const DEFAULT_TIMEOUT_MS = 12_000;

function numericId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function idsFor(item) {
  const tmdbFromContent = String(item?.content_id || "").match(/^tmdb:(\d+)$/i)?.[1];
  const imdbFromContent = String(item?.content_id || "").match(/^(tt\d+)$/i)?.[1];
  return {
    tmdb: numericId(item?._ids?.tmdb) || numericId(tmdbFromContent),
    imdb: String(item?._ids?.imdb || imdbFromContent || "").trim() || null,
  };
}

function isMetaHubUrl(value) {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "metahub.space" || host.endsWith(".metahub.space");
  } catch {
    return false;
  }
}

function tmdbImage(path, size) {
  return typeof path === "string" && path.startsWith("/")
    ? `${TMDB_IMAGE_BASE}/${size}${path}`
    : null;
}

async function fetchJson(url, { fetchImpl, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", ...headers },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${new URL(url).hostname} ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveTmdbId(item, token, fetchImpl) {
  const ids = idsFor(item);
  if (ids.tmdb) return ids.tmdb;
  if (!ids.imdb) return null;

  const body = await fetchJson(`${TMDB_API_BASE}/find/${encodeURIComponent(ids.imdb)}?external_source=imdb_id`, {
    fetchImpl,
    headers: { Authorization: `Bearer ${token}` },
  });
  const results = item.content_type === "movie" ? body?.movie_results : body?.tv_results;
  return numericId(results?.[0]?.id);
}

async function fetchTmdb(item, token, fetchImpl) {
  if (!token) return null;
  const tmdbId = await resolveTmdbId(item, token, fetchImpl);
  if (!tmdbId) return null;

  const kind = item.content_type === "movie" ? "movie" : "tv";
  const headers = { Authorization: `Bearer ${token}` };
  const detailsPromise = fetchJson(`${TMDB_API_BASE}/${kind}/${tmdbId}?language=en-US`, { fetchImpl, headers });
  const episodePromise = kind === "tv" && Number.isInteger(Number(item.season)) && Number.isInteger(Number(item.episode))
    ? fetchJson(`${TMDB_API_BASE}/tv/${tmdbId}/season/${Number(item.season)}/episode/${Number(item.episode)}?language=en-US`, { fetchImpl, headers }).catch(() => null)
    : Promise.resolve(null);
  const [details, episode] = await Promise.all([detailsPromise, episodePromise]);

  const runtime = kind === "movie"
    ? numericId(details?.runtime)
    : numericId(episode?.runtime) || numericId(details?.episode_run_time?.[0]);

  return {
    _provider: "TMDB",
    episodeTitle: episode?.name || null,
    name: details?.title || details?.name || item.name || item._name || null,
    poster: tmdbImage(details?.poster_path, "w500"),
    background: tmdbImage(details?.backdrop_path, "w1280"),
    description: details?.overview || null,
    releaseInfo: String(details?.release_date || details?.first_air_date || "").slice(0, 4) || null,
    genres: Array.isArray(details?.genres) ? details.genres.map((entry) => entry?.name).filter(Boolean) : [],
    runtime,
  };
}

async function fetchCinemetaSafe(item, cinemetaBase, fetchImpl) {
  const { imdb } = idsFor(item);
  if (!imdb) return null;
  const type = item.content_type === "movie" ? "movie" : "series";
  const body = await fetchJson(`${cinemetaBase}/meta/${type}/${encodeURIComponent(imdb)}.json`, { fetchImpl });
  const meta = body?.meta;
  if (!meta) return null;
  const season = Number(item?.season);
  const episode = Number(item?.episode);
  const video = Array.isArray(meta.videos) && Number.isInteger(season) && Number.isInteger(episode)
    ? meta.videos.find((row) => Number(row?.season) === season && Number(row?.episode) === episode)
    : null;
  return {
    _provider: "Cinemeta fallback",
    episodeTitle: video?.title || null,
    name: meta.name || null,
    poster: isMetaHubUrl(meta.poster) ? null : (meta.poster || null),
    background: isMetaHubUrl(meta.background) ? null : (meta.background || null),
    description: meta.description || null,
    releaseInfo: meta.releaseInfo || null,
    imdbRating: Number.isFinite(Number(meta.imdbRating)) ? Number(meta.imdbRating) : null,
    genres: Array.isArray(meta.genres) ? meta.genres : [],
    runtime: meta.runtime || null,
  };
}

function mergeMetadata(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    ...fallback,
    ...primary,
    poster: primary.poster || fallback.poster || null,
    background: primary.background || fallback.background || null,
    description: primary.description || fallback.description || null,
    episodeTitle: primary.episodeTitle || fallback.episodeTitle || null,
    releaseInfo: primary.releaseInfo || fallback.releaseInfo || null,
    genres: primary.genres?.length ? primary.genres : fallback.genres,
    runtime: primary.runtime || fallback.runtime || null,
    imdbRating: fallback.imdbRating ?? primary.imdbRating ?? null,
    _provider: `${primary._provider} → ${fallback._provider}`,
  };
}

export async function resolveTmdbMetadata(item, {
  tmdbReadAccessToken = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  if (!tmdbReadAccessToken) throw new Error("TMDB API Read Access Token is required");
  return fetchTmdb(item, tmdbReadAccessToken, fetchImpl);
}

export async function resolveMetadata(item, {
  tmdbReadAccessToken = "",
  cinemetaBase = "https://v3-cinemeta.strem.io",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");

  let tmdb = null;
  let cinemeta = null;
  if (tmdbReadAccessToken) {
    try { tmdb = await fetchTmdb(item, tmdbReadAccessToken, fetchImpl); } catch { tmdb = null; }
  }

  const needsFallback = !tmdb || !tmdb.runtime || (!tmdb.poster && !tmdb.background);
  if (needsFallback) {
    try { cinemeta = await fetchCinemetaSafe(item, cinemetaBase, fetchImpl); } catch { cinemeta = null; }
  }

  return mergeMetadata(tmdb, cinemeta);
}

export { isMetaHubUrl, tmdbImage };


/**
 * Look up a REAL TMDB episode ID, not the parent TV show's ID.
 * Only media IDs and season/episode numbers are sent to TMDB.
 */
export async function resolveTmdbEpisodeId(item, {
  tmdbReadAccessToken = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!tmdbReadAccessToken) throw new Error("A TMDB read token is required to match new episode IDs.");
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const season = Number(item?.season);
  const episode = Number(item?.episode);
  if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1) {
    throw new Error("Invalid season/episode number");
  }
  const showId = await resolveTmdbId({ ...item, content_type: "series" }, tmdbReadAccessToken, fetchImpl);
  if (!showId) return null;
  const headers = { Authorization: "Bearer " + tmdbReadAccessToken };
  const url = TMDB_API_BASE + "/tv/" + showId + "/season/" + season + "/episode/" + episode + "?language=en-US";
  const detail = await fetchJson(url, { fetchImpl, headers });
  if (!numericId(detail?.id) || Number(detail.season_number) !== season || Number(detail.episode_number) !== episode) {
    return null;
  }
  return {
    ids: { tmdb: Number(detail.id) },
    showTmdbId: showId,
    episodeTitle: detail.name || null,
  };
}
