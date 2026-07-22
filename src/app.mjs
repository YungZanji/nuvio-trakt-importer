import { unzipSync, strFromU8 } from "fflate";
import {
  IMPORTER_VERSION,
  NUVIO_REPO_COMMIT,
  NUVIO_PUBLIC_ANON_KEY,
  applyRuntime,
  buildAudit,
  buildImportPlan,
  chunk,
  mergeLibrary,
  mergeProgress,
  mergeWatchedItems,
  parseRuntimeMinutes,
  stripPrivateFields,
} from "./core.mjs";

const API_BASES = ["https://api.nuvio.tv", "https://api-two.nuvioapp.space"];
const ANON_KEY = NUVIO_PUBLIC_ANON_KEY;
const TV_LOGIN_URL = "https://nuvio.tv/tv-login";
const CINEMETA_BASE = "https://v3-cinemeta.strem.io";
const REQUEST_TIMEOUT_MS = 15_000;

const state = {
  plan: null,
  token: null,
  refreshToken: null,
  login: null,
  profiles: [],
  selectedProfile: null,
  remoteBefore: null,
  metadataById: new Map(),
  unresolvedProgress: [],
  backupDownloaded: false,
  loginPollTimer: null,
  loginPollInFlight: false,
  loginExchangeInFlight: false,
  loginSetupInFlight: false,
  refreshPromise: null,
  loginPollAttempts: 0,
  importerClientId: `nuvio-import-${crypto.randomUUID().replaceAll("-", "").slice(0, 32)}`,
};

const $ = (id) => document.getElementById(id);

function setStatus(message, kind = "info") {
  const box = $("status");
  box.textContent = message;
  box.dataset.kind = kind;
  box.hidden = !message;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label || "Working…";
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function readZip(file) {
  return file.arrayBuffer().then((buffer) => {
    const files = unzipSync(new Uint8Array(buffer));
    const jsonFiles = new Map();
    for (const [name, bytes] of Object.entries(files)) {
      if (name.toLowerCase().endsWith(".json")) jsonFiles.set(name, strFromU8(bytes));
    }
    return jsonFiles;
  });
}

function renderPlan(plan) {
  $("summary").hidden = false;
  $("count-library").textContent = formatNumber(plan.library.length);
  $("count-watched").textContent = formatNumber(plan.watchedItems.length);
  $("count-progress").textContent = formatNumber(plan.progress.length);
  $("count-history").textContent = formatNumber(plan.sourceSummary.historyPlays);
  $("count-ratings").textContent = formatNumber(plan.unsupported.ratings);
  $("count-lists").textContent = formatNumber(plan.unsupported.personalLists);
  $("metadata-consent-row").hidden = plan.progress.length === 0 && plan.library.length === 0;
  $("metadata-button").disabled = false;
  $("login-button").disabled = false;

  const warnings = [];
  if (plan.parseErrors.length) warnings.push(`${plan.parseErrors.length} JSON file(s) could not be parsed`);
  if (plan.missingIds.length) warnings.push(`${plan.missingIds.length} item(s) lack a compatible content ID`);
  if (plan.sourceSummary.lowProgressEntries) {
    warnings.push(`${plan.sourceSummary.lowProgressEntries} playback item is below Nuvio's 2% Continue Watching display threshold; its exact progress will still be stored`);
  }
  $("plan-warnings").textContent = warnings.join(". ");
  $("plan-warnings").hidden = warnings.length === 0;
}

async function onZipSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  setStatus("Reading the Trakt archive locally…");
  try {
    const textFiles = await readZip(file);
    state.plan = buildImportPlan(textFiles);
    state.metadataById.clear();
    state.unresolvedProgress = [];
    state.remoteBefore = null;
    state.backupDownloaded = false;
    renderPlan(state.plan);
    setStatus(`Archive ready: ${formatNumber(state.plan.watchedItems.length)} watched states and ${formatNumber(state.plan.progress.length)} resume positions found.`, "success");
  } catch (error) {
    setStatus(`Could not read this ZIP: ${error.message || error}`, "error");
  }
}

function parseMetaRuntime(meta) {
  return parseRuntimeMinutes(meta?.runtime);
}

async function fetchCinemeta(item) {
  if (!item.content_id?.startsWith("tt")) return null;
  const type = item.content_type === "movie" ? "movie" : "series";
  const response = await fetch(`${CINEMETA_BASE}/meta/${type}/${encodeURIComponent(item.content_id)}.json`);
  if (!response.ok) throw new Error(`Cinemeta ${response.status}`);
  const body = await response.json();
  return body?.meta ?? null;
}

async function mapConcurrent(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let completed = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error };
      } finally {
        completed++;
        onProgress?.(completed, items.length);
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function hydrateLibraryItem(item, meta) {
  const imdbFallback = item.content_id.startsWith("tt") ? item.content_id : null;
  return {
    ...item,
    name: meta?.name || item.name,
    poster: meta?.poster || (imdbFallback ? `https://images.metahub.space/poster/small/${imdbFallback}/img` : item.poster),
    background: meta?.background || (imdbFallback ? `https://images.metahub.space/background/medium/${imdbFallback}/img` : item.background),
    description: meta?.description || item.description,
    release_info: meta?.releaseInfo || item.release_info,
    imdb_rating: Number.isFinite(Number(meta?.imdbRating)) ? Number(meta.imdbRating) : item.imdb_rating,
    genres: Array.isArray(meta?.genres) ? meta.genres : item.genres,
    addon_base_url: item.addon_base_url || `${CINEMETA_BASE}/manifest.json`,
  };
}

function renderUnresolved() {
  const section = $("unresolved-section");
  const body = $("unresolved-body");
  body.replaceChildren();
  if (!state.unresolvedProgress.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  for (const item of state.unresolvedProgress) {
    const row = document.createElement("tr");
    row.innerHTML = `<td></td><td></td><td><input type="number" min="1" max="600" step="1" inputmode="numeric" aria-label="Runtime in minutes"></td>`;
    row.children[0].textContent = item._name;
    row.children[1].textContent = item.content_type === "movie" ? "Movie" : `S${item.season}E${item.episode}`;
    const input = row.querySelector("input");
    input.dataset.key = item.progress_key;
    input.placeholder = item.content_type === "movie" ? "100" : "45";
    body.append(row);
  }
}

async function enrichMetadata() {
  if (!state.plan) return;
  if (!$("metadata-consent").checked) {
    setStatus("Please approve the metadata lookup first. Only public IMDb IDs are sent, never your ZIP, Nuvio account, timestamps, or ratings.", "error");
    return;
  }
  const button = $("metadata-button");
  setBusy(button, true, "Resolving metadata…");
  try {
    const unique = new Map();
    for (const item of [...state.plan.library, ...state.plan.progress]) {
      if (!unique.has(item.content_id)) unique.set(item.content_id, item);
    }
    const items = [...unique.values()];
    const results = await mapConcurrent(items, 5, fetchCinemeta, (done, total) => {
      setStatus(`Resolving artwork and runtime: ${done}/${total}…`);
    });
    results.forEach((result, index) => {
      if (result && !result.error) state.metadataById.set(items[index].content_id, result);
    });

    state.plan.library = state.plan.library.map((item) => hydrateLibraryItem(item, state.metadataById.get(item.content_id)));
    state.plan.progress = state.plan.progress.map((item) => applyRuntime(item, parseMetaRuntime(state.metadataById.get(item.content_id))));
    state.unresolvedProgress = state.plan.progress.filter((item) => item.duration <= 0);
    renderUnresolved();
    $("metadata-state").textContent = state.unresolvedProgress.length
      ? `${state.unresolvedProgress.length} resume item(s) still need a runtime.`
      : `All ${state.plan.progress.length} resume positions have a runtime.`;
    $("metadata-state").dataset.kind = state.unresolvedProgress.length ? "warning" : "success";
    updateImportReadiness();
    setStatus(state.unresolvedProgress.length
      ? "Metadata lookup finished. Enter a runtime for the unresolved items below."
      : "Metadata and exact resume positions are ready.", state.unresolvedProgress.length ? "warning" : "success");
  } catch (error) {
    setStatus(`Metadata lookup failed: ${error.message || error}`, "error");
  } finally {
    setBusy(button, false);
  }
}

function applyManualRuntimes(useEstimates = false) {
  const values = new Map();
  for (const input of $("unresolved-body").querySelectorAll("input")) {
    let value = Number(input.value);
    if ((!Number.isFinite(value) || value <= 0) && useEstimates) {
      const item = state.unresolvedProgress.find((entry) => entry.progress_key === input.dataset.key);
      value = item?.content_type === "movie" ? 100 : 45;
      input.value = String(value);
    }
    if (Number.isFinite(value) && value > 0) values.set(input.dataset.key, value);
  }
  state.plan.progress = state.plan.progress.map((item) => values.has(item.progress_key) ? applyRuntime(item, values.get(item.progress_key)) : item);
  state.unresolvedProgress = state.plan.progress.filter((item) => item.duration <= 0);
  renderUnresolved();
  updateImportReadiness();
  setStatus(state.unresolvedProgress.length ? `${state.unresolvedProgress.length} runtime(s) are still missing.` : "All resume positions are ready.", state.unresolvedProgress.length ? "warning" : "success");
}

function publicHeaders(token = null) {
  const headers = { apikey: ANON_KEY, "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function setLoginDiagnostics(message) {
  $("login-diagnostics").textContent = `${new Date().toLocaleTimeString()}: ${message}`;
}

async function requestAtBase(baseUrl, path, body, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: publicHeaders(token),
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = typeof data === "object" ? (data.message || data.error_description || data.error || JSON.stringify(data)) : data;
    const error = new Error(`${response.status}: ${message || "Nuvio request failed"}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function apiRequest(path, body = {}, token = state.token, { allowRefresh = true } = {}) {
  let lastError;
  for (let index = 0; index < API_BASES.length; index++) {
    const baseUrl = API_BASES[index];
    try {
      return await requestAtBase(baseUrl, path, body, token);
    } catch (error) {
      lastError = error;
      if (allowRefresh && error?.status === 401 && token && token === state.token && state.refreshToken) {
        await refreshAccessToken();
        return apiRequest(path, body, state.token, { allowRefresh: false });
      }
      const retryableStatus = error?.status == null || [502, 503, 504].includes(error.status);
      if (!retryableStatus || index === API_BASES.length - 1) throw error;
      setLoginDiagnostics(`Primary Nuvio API did not respond; trying the fallback API.`);
    }
  }
  throw lastError || new Error("Nuvio request failed");
}

async function refreshAccessToken() {
  if (!state.refreshToken) throw new Error("Nuvio did not provide a refresh token");
  if (state.refreshPromise) return state.refreshPromise;
  state.refreshPromise = (async () => {
    setLoginDiagnostics("Nuvio rejected the first Sync request. Refreshing the approved session once.");
    const tokens = await apiRequest("/auth/v1/token?grant_type=refresh_token", {
      refresh_token: state.refreshToken,
    }, null, { allowRefresh: false });
    if (!tokens?.access_token) throw new Error("Nuvio did not return a refreshed access token");
    state.token = tokens.access_token;
    state.refreshToken = tokens.refresh_token || state.refreshToken;
  })();
  try {
    await state.refreshPromise;
  } finally {
    state.refreshPromise = null;
  }
}

async function rpc(name, params = {}, token = state.token) {
  return apiRequest(`/rest/v1/rpc/${name}`, params, token);
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function startLogin() {
  if (!state.plan) return;
  const button = $("login-button");
  setBusy(button, true, "Starting sign-in…");
  try {
    state.token = null;
    state.refreshToken = null;
    state.profiles = [];
    state.selectedProfile = null;
    $("profile-panel").hidden = true;
    $("prepare-button").disabled = true;
    const nonce = randomNonce();
    const rows = await apiRequest("/rest/v1/rpc/start_tv_login_session", {
      p_device_nonce: nonce,
      p_redirect_base_url: TV_LOGIN_URL,
      p_device_name: "Trakt Export Importer",
    }, null);
    const login = rows?.[0];
    if (!login?.code || !login?.web_url) throw new Error("Nuvio returned an incomplete login session");
    state.login = { ...login, nonce };
    state.loginPollAttempts = 0;
    state.loginPollInFlight = false;
    state.loginExchangeInFlight = false;
    state.loginSetupInFlight = false;
    if (state.loginPollTimer) clearTimeout(state.loginPollTimer);
    $("login-panel").hidden = false;
    $("login-link").href = login.web_url;
    $("login-code").textContent = login.code;
    $("login-state").textContent = "Waiting for approval…";
    delete $("login-state").dataset.kind;
    $("approval-button").disabled = false;
    setLoginDiagnostics("Sign-in session created. Automatic approval checks started.");
    setStatus("Open the Nuvio sign-in page, approve this importer, then return here.");
    scheduleLoginPoll(0);
  } catch (error) {
    setStatus(`Could not start Nuvio sign-in: ${error.message || error}`, "error");
  } finally {
    setBusy(button, false);
  }
}

function scheduleLoginPoll(delayMs) {
  if (state.loginPollTimer) clearTimeout(state.loginPollTimer);
  state.loginPollTimer = setTimeout(() => {
    state.loginPollTimer = null;
    pollLogin();
  }, delayMs);
}

async function finishLogin({ manual = false } = {}) {
  const login = state.login;
  if (!login || state.loginExchangeInFlight) return;
  if (state.token) {
    await completeLoginSetup();
    return;
  }
  state.loginExchangeInFlight = true;
  const button = $("approval-button");
  setBusy(button, true, manual ? "Checking approval…" : "Finishing sign-in…");
  $("login-state").textContent = manual ? "Checking your approval directly…" : "Approved. Finishing sign-in…";
  setLoginDiagnostics(`${manual ? "Manual" : "Automatic"} token exchange started.`);
  try {
    const tokens = await apiRequest("/functions/v1/tv-logins-exchange", {
      code: login.code,
      device_nonce: login.nonce,
    }, null);
    if (!tokens?.access_token) throw new Error("Nuvio did not return an access token");
    state.token = tokens.access_token;
    state.refreshToken = tokens.refresh_token || null;
    if (state.loginPollTimer) clearTimeout(state.loginPollTimer);
    state.loginPollTimer = null;
    setBusy(button, false);
    button.disabled = false;
    setLoginDiagnostics("Approval accepted and Nuvio access token received.");
    await completeLoginSetup();
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "The approval check timed out. Click the button again."
      : String(error?.message || error);
    $("login-state").textContent = error?.status === 401
      ? "Approval reached Nuvio, but its token exchange is not ready yet. Retrying…"
      : manual
        ? `Could not finish sign-in: ${message}`
        : "Automatic check was interrupted. You can use the button below.";
    $("login-state").dataset.kind = "warning";
    setLoginDiagnostics(`Token exchange failed: ${message}`);
    if (!state.token) {
      setStatus(manual
        ? `Nuvio has not released the approved session yet. Confirm the approval page says approved, then click “I’ve approved it, continue” again.`
        : `The automatic sign-in check stalled. Click “I’ve approved it, continue” to finish directly.`, "warning");
      scheduleLoginPoll(5000);
    }
  } finally {
    state.loginExchangeInFlight = false;
    if (!state.token) setBusy(button, false);
  }
}

async function completeLoginSetup() {
  if (!state.token || state.loginSetupInFlight) return;
  state.loginSetupInFlight = true;
  const button = $("approval-button");
  setBusy(button, true, "Checking Nuvio Sync…");
  $("login-state").textContent = "Approved. Verifying the Nuvio Sync session…";
  delete $("login-state").dataset.kind;
  try {
    await loadProfiles();
    $("login-state").textContent = "Signed in to Nuvio Sync.";
    $("login-state").dataset.kind = "success";
    setLoginDiagnostics("Approval accepted, session verified, and Nuvio profiles loaded.");
    setStatus("Signed in. Choose the Nuvio profile that should receive the import.", "success");
    setBusy(button, false);
    button.textContent = "Nuvio Sync connected";
    button.disabled = true;
  } catch (error) {
    const message = error?.name === "AbortError" ? "request timed out" : String(error?.message || error);
    $("login-state").textContent = `Approved, but the Sync session check failed: ${message}`;
    $("login-state").dataset.kind = "warning";
    setLoginDiagnostics(`Post-approval Sync check failed: ${message}. The session can be retried without another approval.`);
    setStatus("Your approval succeeded, but Nuvio rejected the first Sync read. Click “Retry Nuvio Sync”; the importer will refresh the session automatically.", "warning");
    setBusy(button, false);
    button.textContent = "Retry Nuvio Sync";
    button.disabled = false;
  } finally {
    state.loginSetupInFlight = false;
  }
}

async function pollLogin() {
  const login = state.login;
  if (!login || state.token || state.loginPollInFlight || state.loginExchangeInFlight) return;
  const expiresAt = Date.parse(login.expires_at || "");
  if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) {
    $("login-state").textContent = "Expired. Start sign-in again.";
    return;
  }
  state.loginPollInFlight = true;
  state.loginPollAttempts++;
  setLoginDiagnostics(`Automatic approval check ${state.loginPollAttempts} started.`);
  try {
    const rows = await apiRequest("/rest/v1/rpc/poll_tv_login_session", {
      p_code: login.code,
      p_device_nonce: login.nonce,
    }, null);
    if (state.token) return;
    const status = String(rows?.[0]?.status || "pending").toLowerCase();
    $("login-state").textContent = status === "approved" ? "Approved. Finishing sign-in…" : `Status: ${status}`;
    setLoginDiagnostics(`Automatic approval check ${state.loginPollAttempts} returned: ${status}.`);
    if (status === "approved") {
      state.loginPollInFlight = false;
      await finishLogin({ manual: false });
      return;
    }
    if (["expired", "used", "cancelled"].includes(status)) return;
  } catch (error) {
    const message = error?.name === "AbortError" ? "request timed out" : String(error?.message || error);
    $("login-state").textContent = "Automatic check delayed. Use the button below if you already approved it.";
    setLoginDiagnostics(`Automatic approval check ${state.loginPollAttempts} failed: ${message}. Retrying.`);
  } finally {
    state.loginPollInFlight = false;
  }
  if (!state.token) scheduleLoginPoll(Math.max(2000, Number(login.poll_interval_seconds || 3) * 1000));
}

async function loadProfiles() {
  const profiles = await rpc("sync_pull_profiles", {});
  state.profiles = Array.isArray(profiles) && profiles.length
    ? profiles
    : [{ profile_index: 1, name: "Primary profile" }];
  const select = $("profile-select");
  select.replaceChildren();
  for (const profile of state.profiles) {
    const option = document.createElement("option");
    option.value = String(profile.profile_index);
    option.textContent = `${profile.name || "Profile"} (Profile ${profile.profile_index})`;
    select.append(option);
  }
  $("profile-panel").hidden = false;
  $("prepare-button").disabled = false;
}

async function pullLibrary(profileId) {
  const items = [];
  let offset = 0;
  while (true) {
    const page = await rpc("sync_pull_library", { p_profile_id: profileId, p_limit: 500, p_offset: offset });
    items.push(...(Array.isArray(page) ? page : []));
    if (!Array.isArray(page) || page.length < 500) return items;
    offset += 500;
  }
}

async function pullWatched(profileId) {
  const items = [];
  let pageNumber = 1;
  while (true) {
    const page = await rpc("sync_pull_watched_items", { p_profile_id: profileId, p_page: pageNumber, p_page_size: 900 });
    items.push(...(Array.isArray(page) ? page : []));
    if (!Array.isArray(page) || page.length < 900) return items;
    pageNumber++;
  }
}

async function pullProgress(profileId) {
  const items = await rpc("sync_pull_watch_progress", { p_profile_id: profileId });
  return Array.isArray(items) ? items : [];
}

async function prepareRemote() {
  const button = $("prepare-button");
  setBusy(button, true, "Reading Nuvio Sync…");
  try {
    const profileId = Number($("profile-select").value);
    state.selectedProfile = state.profiles.find((profile) => Number(profile.profile_index) === profileId) || { profile_index: profileId, name: `Profile ${profileId}` };
    setStatus("Reading existing Nuvio data so nothing gets overwritten…");
    const [library, watchedItems, watchProgress] = await Promise.all([
      pullLibrary(profileId),
      pullWatched(profileId),
      pullProgress(profileId),
    ]);
    state.remoteBefore = { library, watchedItems, watchProgress };
    state.backupDownloaded = false;
    $("backup-button").disabled = false;
    $("remote-summary").hidden = false;
    $("remote-summary").textContent = `Existing Nuvio data: ${formatNumber(library.length)} library items, ${formatNumber(watchedItems.length)} watched states, ${formatNumber(watchProgress.length)} progress items.`;
    updateImportReadiness();
    setStatus("Existing Nuvio data is ready. Download the backup before importing.", "success");
  } catch (error) {
    setStatus(`Could not read Nuvio Sync: ${error.message || error}`, "error");
  } finally {
    setBusy(button, false);
  }
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadBackup() {
  if (!state.remoteBefore || !state.selectedProfile) return;
  downloadJson(`nuvio-sync-backup-${new Date().toISOString().slice(0, 10)}.json`, {
    format: "nuvio-sync-importer-backup-v1",
    createdAt: new Date().toISOString(),
    nuvioRepositoryCommit: NUVIO_REPO_COMMIT,
    profile: state.selectedProfile,
    data: state.remoteBefore,
  });
  state.backupDownloaded = true;
  updateImportReadiness();
  setStatus("Backup downloaded. You can now start the import.", "success");
}

function updateImportReadiness() {
  const ready = Boolean(
    state.plan &&
    state.token &&
    state.remoteBefore &&
    state.backupDownloaded &&
    state.unresolvedProgress.length === 0 &&
    state.plan.progress.every((item) => item.duration > 0 && item.position > 0)
  );
  $("import-button").disabled = !ready;
}

function sanitizeLibrary(items) {
  return items.map((item) => ({
    content_id: item.content_id,
    content_type: item.content_type,
    name: item.name || item.content_id,
    poster: item.poster ?? null,
    poster_shape: item.poster_shape || "POSTER",
    background: item.background ?? null,
    description: item.description ?? null,
    release_info: item.release_info ?? null,
    imdb_rating: item.imdb_rating ?? null,
    genres: Array.isArray(item.genres) ? item.genres : [],
    addon_base_url: item.addon_base_url ?? null,
    added_at: Number(item.added_at || Date.now()),
  }));
}

function sanitizeWatched(items) {
  return items.map((item) => ({
    content_id: item.content_id,
    content_type: item.content_type,
    title: item.title || item.content_id,
    season: item.season ?? null,
    episode: item.episode ?? null,
    watched_at: Number(item.watched_at || 0),
  }));
}

function sanitizeProgress(items) {
  return items.map((item) => ({
    content_id: item.content_id,
    content_type: item.content_type,
    video_id: item.video_id,
    season: item.season ?? null,
    episode: item.episode ?? null,
    position: Number(item.position),
    duration: Number(item.duration),
    last_watched: Number(item.last_watched),
    progress_key: item.progress_key,
  }));
}

function keyWatched(item) {
  return `${item.content_id}|${item.season ?? ""}|${item.episode ?? ""}`;
}

function keyProgress(item) {
  return item.progress_key;
}

async function runImport() {
  if (!state.plan || !state.remoteBefore || !state.selectedProfile) return;
  const button = $("import-button");
  setBusy(button, true, "Importing…");
  button.disabled = true;
  try {
    const profileId = Number(state.selectedProfile.profile_index);
    const importedLibrary = sanitizeLibrary(state.plan.library);
    const importedWatched = sanitizeWatched(state.plan.watchedItems);
    const importedProgress = sanitizeProgress(state.plan.progress);
    const mergedLibrary = sanitizeLibrary(mergeLibrary(state.remoteBefore.library, importedLibrary));

    setStatus(`Uploading merged library (${formatNumber(mergedLibrary.length)} items)…`);
    await rpc("sync_push_library", {
      p_items: mergedLibrary,
      p_profile_id: profileId,
      p_origin_client_id: state.importerClientId,
    });

    const watchedBatches = chunk(importedWatched, 350);
    for (let index = 0; index < watchedBatches.length; index++) {
      setStatus(`Uploading watched states: batch ${index + 1}/${watchedBatches.length}…`);
      await rpc("sync_push_watched_items", {
        p_items: watchedBatches[index],
        p_profile_id: profileId,
        p_origin_client_id: state.importerClientId,
      });
    }

    const progressBatches = chunk(importedProgress, 300);
    for (let index = 0; index < progressBatches.length; index++) {
      setStatus(`Uploading resume positions: batch ${index + 1}/${progressBatches.length}…`);
      await rpc("sync_push_watch_progress", {
        p_entries: progressBatches[index],
        p_profile_id: profileId,
        p_origin_client_id: state.importerClientId,
      });
    }

    setStatus("Verifying every imported record in Nuvio Sync…");
    const [libraryAfter, watchedAfter, progressAfter] = await Promise.all([
      pullLibrary(profileId),
      pullWatched(profileId),
      pullProgress(profileId),
    ]);
    const libraryKeys = new Set(libraryAfter.map((item) => `${item.content_type}|${item.content_id}`));
    const watchedKeys = new Set(watchedAfter.map(keyWatched));
    const progressKeys = new Set(progressAfter.map(keyProgress));
    const missingLibrary = importedLibrary.filter((item) => !libraryKeys.has(`${item.content_type}|${item.content_id}`));
    const missingWatched = importedWatched.filter((item) => !watchedKeys.has(keyWatched(item)));
    const missingProgress = importedProgress.filter((item) => !progressKeys.has(keyProgress(item)));
    if (missingLibrary.length || missingWatched.length || missingProgress.length) {
      throw new Error(`Verification found missing records (library ${missingLibrary.length}, watched ${missingWatched.length}, progress ${missingProgress.length}). The backup remains available and the audit has not been marked successful.`);
    }

    const metadataResolved = state.plan.progress.length - state.unresolvedProgress.length;
    const audit = buildAudit(state.plan, {
      profile: state.selectedProfile,
      metadata: {
        provider: "Cinemeta (public IMDb metadata)",
        resolvedContentIds: state.metadataById.size,
        resumePositionsWithRuntime: metadataResolved,
      },
      remoteBefore: {
        libraryItems: state.remoteBefore.library.length,
        watchedItems: state.remoteBefore.watchedItems.length,
        watchProgressItems: state.remoteBefore.watchProgress.length,
      },
      remoteAfter: {
        libraryItems: libraryAfter.length,
        watchedItems: watchedAfter.length,
        watchProgressItems: progressAfter.length,
        verifiedImportedLibraryItems: importedLibrary.length,
        verifiedImportedWatchedItems: importedWatched.length,
        verifiedImportedWatchProgressItems: importedProgress.length,
      },
    });
    downloadJson(`nuvio-trakt-import-audit-${new Date().toISOString().slice(0, 10)}.json`, audit);
    $("success-panel").hidden = false;
    $("success-summary").textContent = `Verified ${formatNumber(importedLibrary.length)} library items, ${formatNumber(importedWatched.length)} watched movie/episode states, and ${formatNumber(importedProgress.length)} resume positions in Nuvio Sync.`;
    setStatus("Import complete and verified. The audit report has been downloaded.", "success");
  } catch (error) {
    setStatus(`Import stopped: ${error.message || error}`, "error");
    updateImportReadiness();
  } finally {
    setBusy(button, false);
  }
}

$("zip-input").addEventListener("change", onZipSelected);
$("metadata-button").addEventListener("click", enrichMetadata);
$("manual-runtime-button").addEventListener("click", () => applyManualRuntimes(false));
$("estimate-runtime-button").addEventListener("click", () => applyManualRuntimes(true));
$("login-button").addEventListener("click", startLogin);
$("approval-button").addEventListener("click", () => finishLogin({ manual: true }));
$("prepare-button").addEventListener("click", prepareRemote);
$("backup-button").addEventListener("click", downloadBackup);
$("import-button").addEventListener("click", runImport);
$("profile-select").addEventListener("change", () => {
  state.remoteBefore = null;
  state.backupDownloaded = false;
  $("backup-button").disabled = true;
  $("remote-summary").hidden = true;
  updateImportReadiness();
});

window.addEventListener("beforeunload", () => {
  if (state.loginPollTimer) clearTimeout(state.loginPollTimer);
  state.token = null;
  state.refreshToken = null;
});

$("repo-commit").textContent = NUVIO_REPO_COMMIT.slice(0, 12);
$("importer-version").textContent = `v${IMPORTER_VERSION}`;
