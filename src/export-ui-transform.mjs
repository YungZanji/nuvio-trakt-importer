function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Expected ${label} block was not found`);
  return source.replace(needle, replacement);
}

export function patchExportUiSource(source) {
  let patched = `import { zipSync, strToU8 } from "fflate";\nimport { buildMergedTraktExport } from "./trakt-exporter.mjs";\nimport { buildTraktImportJson } from "./trakt-import-json.mjs";\nimport { resolveTmdbSeasonEpisodeIds } from "./metadata-provider.mjs";\nimport { createTraktAuthorization, exchangeTraktCode, makeTraktApi, buildTraktSyncCandidates, planTraktSync, executeTraktSync } from "./trakt-direct-sync.mjs";\n${source}`;

  patched = replaceRequired(
    patched,
    "const state = {\n",
    `let activeTool = "import";
let exportArchiveFiles = null;
let exportArchiveTextFiles = null;
let exportMergeResult = null;
let exportCandidates = null;
let exportExcludedChanges = new Set();
let exportMetadata = new Map();
let exportLookupInFlight = false;
let exportEpisodeIds = new Map();
let exportImportPreview = null;
let exportEpisodeLookupInFlight = false;
let traktConnection = null;
let traktAuthAttempt = null;
let traktLivePlan = null;
let traktBusy = false;

const state = {
`,
    "exporter state",
  );

  patched = replaceRequired(
    patched,
    'async function startLogin() {\n  const button = $("login-button");\n',
    'async function startLogin() {\n  const button = activeTool === "export" ? $("export-login-button") : $("login-button");\n',
    "mode-aware Nuvio sign-in button",
  );

  patched = replaceRequired(
    patched,
    '    setStatus("Signed in. Choose the Nuvio profile that should receive the import.", "success");\n',
    '    setStatus(activeTool === "export" ? "Signed in. Choose the Nuvio profile you want to merge into the Trakt archive." : "Signed in. Choose the Nuvio profile that should receive the import.", "success");\n',
    "mode-aware sign-in status",
  );

  patched = replaceRequired(
    patched,
    '    button.textContent = "Nuvio Sync connected";\n    button.disabled = true;\n',
    '    button.textContent = "Nuvio Sync connected";\n    button.disabled = true;\n    if ($("export-login-button")) { $("export-login-button").textContent = "Nuvio Sync connected"; $("export-login-button").disabled = true; }\n',
    "export sign-in button state",
  );

  patched = replaceRequired(
    patched,
    '    setStatus("Existing Nuvio data is ready. Download the backup before importing.", "success");\n',
    '    renderExportPreview();\n    updateExportReadiness();\n    setStatus(activeTool === "export" ? "Nuvio data is ready. Review the exact changes, then download the merged Trakt archive." : "Existing Nuvio data is ready. Download the backup before importing.", "success");\n',
    "export preview after Nuvio read",
  );

  patched = replaceRequired(
    patched,
    'window.addEventListener("beforeunload", () => {\n',
    `function exportJsonTextFiles(files) {
  const textFiles = new Map();
  for (const [path, bytes] of Object.entries(files || {})) {
    if (!path.toLowerCase().endsWith(".json")) continue;
    try {
      textFiles.set(path, strFromU8(bytes));
    } catch {
      // Preserve unreadable files untouched in the resulting ZIP.
    }
  }
  return textFiles;
}

function exportBasename(path) {
  return String(path || "").split("/").pop() || "";
}

function exportReadArray(textFiles, path) {
  if (!textFiles?.has(path)) return [];
  try {
    const value = JSON.parse(textFiles.get(path));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function exportIdsKey(ids) {
  if (!ids || typeof ids !== "object") return "";
  for (const name of ["imdb", "tmdb", "trakt", "tvdb"]) {
    const value = ids[name];
    if (value !== undefined && value !== null && String(value).trim()) return name + ":" + String(value).trim().toLowerCase();
  }
  return "";
}

function exportEntryMedia(entry) {
  return entry?.movie || entry?.show || null;
}

function exportEntryIdentity(entry) {
  const media = exportEntryMedia(entry);
  const mediaKey = exportIdsKey(media?.ids) || String(media?.title || "").trim().toLowerCase();
  if (!mediaKey) return "";
  if (entry?.type === "episode" && entry?.episode) {
    return "episode|" + mediaKey + "|" + Number(entry.episode.season) + "|" + Number(entry.episode.number);
  }
  return (entry?.movie ? "movie" : "show") + "|" + mediaKey;
}

function exportHistoryIdentity(entry) {
  const key = exportEntryIdentity(entry);
  return key ? key + "|" + String(entry?.watched_at || "") : "";
}

function exportFormatTimestamp(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return String(value || "unknown time");
  return new Date(parsed).toLocaleString();
}

function exportTitleLabel(entry) {
  const media = exportEntryMedia(entry);
  const title = media?.title || "Unknown title";
  const year = Number(media?.year);
  const yearText = Number.isInteger(year) && year > 1800 ? " (" + year + ")" : "";
  if (entry?.type === "episode" && entry?.episode) {
    const season = String(Number(entry.episode.season)).padStart(2, "0");
    const episode = String(Number(entry.episode.number)).padStart(2, "0");
    const episodeTitle = entry.episode.title ? " · " + entry.episode.title : "";
    return title + yearText + " · S" + season + "E" + episode + episodeTitle;
  }
  return title + yearText;
}

function exportChangeLabel(row, kind) {
  const entry = row.entry;
  const title = exportTitleLabel(entry);
  if (kind === "watchlist") return (entry?.movie ? "Movie" : "Show") + " · " + title + " · added " + exportFormatTimestamp(entry?.listed_at);
  if (kind === "history") return (entry?.type === "episode" ? "Episode" : "Movie") + " · " + title + " · watched " + exportFormatTimestamp(entry?.watched_at);
  if (row.action === "clear") return "Clear finished playback · " + title + " · was " + Number(entry?.progress || 0).toFixed(1) + "%";
  if (row.action === "update") return "Update · " + title + " · " + Number(row.previous?.progress || 0).toFixed(1) + "% → " + Number(entry?.progress || 0).toFixed(1) + "% · paused " + exportFormatTimestamp(entry?.paused_at);
  return "Add · " + title + " · " + Number(entry?.progress || 0).toFixed(1) + "% · paused " + exportFormatTimestamp(entry?.paused_at);
}

function exportChangeCode(entry) {
  const media = exportEntryMedia(entry);
  const ids = media?.ids || {};
  const id = ids.imdb || (ids.tmdb ? "tmdb:" + ids.tmdb : ids.tvdb ? "tvdb:" + ids.tvdb : "");
  const unknown = !media?.title || /^(tt\d+|tmdb:\d+|tvdb:\d+|unknown title)$/i.test(String(media.title));
  return (unknown ? "Unresolved title · " : "Media ID · ") + (id || "unidentified");
}

function exportPopulateChangeList(listId, countId, rows, emptyText, kind) {
  const list = $(listId);
  const count = $(countId);
  if (count) count.textContent = formatNumber(rows.length);
  if (!list) return;
  list.replaceChildren();
  if (!rows.length) {
    const item = document.createElement("li");
    item.className = "empty-change";
    item.textContent = emptyText;
    list.append(item);
    return;
  }
  for (const row of rows) {
    const item = document.createElement("li");
    const label = document.createElement("label");
    label.className = "export-choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !exportExcludedChanges.has(row.id);
    input.setAttribute("aria-label", "Include " + exportChangeLabel(row, kind));
    input.addEventListener("change", () => {
      if (input.checked) exportExcludedChanges.delete(row.id);
      else exportExcludedChanges.add(row.id);
      renderExportPreview();
    });
    const copy = document.createElement("span");
    copy.className = "change-copy";
    const title = document.createElement("span");
    title.textContent = exportChangeLabel(row, kind);
    const code = document.createElement("small");
    code.className = "change-code";
    code.textContent = exportChangeCode(row.entry);
    copy.append(title, code);
    label.append(input, copy);
    item.append(label);
    list.append(item);
  }
}

function renderExportExactChanges(candidate) {
  const changes = candidate.changes;
  exportPopulateChangeList("export-detail-watchlist", "export-detail-watchlist-count", changes.watchlist, "No new watchlist items.", "watchlist");
  exportPopulateChangeList("export-detail-history", "export-detail-history-count", changes.history, "No newer watched entries.", "history");
  exportPopulateChangeList("export-detail-playback", "export-detail-playback-count", changes.playback, "No playback changes.", "playback");
}

function exportAllCandidateRows() {
  if (!exportCandidates) return [];
  return [...exportCandidates.changes.watchlist, ...exportCandidates.changes.history, ...exportCandidates.changes.playback];
}

function exportMetadataTargets() {
  const seen = new Set();
  const targets = [];
  for (const change of exportAllCandidateRows()) {
    const media = exportEntryMedia(change.entry);
    const ids = media?.ids || {};
    const title = String(media?.title || "").trim();
    const unknown = !title || /^(tt\d+|tmdb:\d+|tvdb:\d+|unknown title)$/i.test(title);
    const missingEpisode = change.entry?.type === "episode" && !change.entry?.episode?.title;
    if (!unknown && !missingEpisode) continue;
    const contentId = ids.imdb || (ids.tmdb ? "tmdb:" + ids.tmdb : "");
    if (!contentId) continue;
    const lower = String(contentId).toLowerCase();
    if (unknown && !seen.has(lower)) {
      seen.add(lower);
      targets.push({ id: lower, item: { content_id: contentId, content_type: change.entry?.movie ? "movie" : "series" } });
    }
    const season = Number(change.entry?.episode?.season);
    const episode = Number(change.entry?.episode?.number);
    if (missingEpisode && Number.isInteger(season) && Number.isInteger(episode)) {
      const key = lower + "|s" + season + "e" + episode;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({ id: key, item: { content_id: contentId, content_type: "series", season, episode } });
      }
    }
  }
  return targets;
}

async function exportResolveTitles() {
  if (exportLookupInFlight || !exportArchiveTextFiles || !state.remoteBefore) return;
  const input = $("export-metadata-token");
  const token = String(input?.value || "").trim();
  if (input) input.value = "";
  const targets = exportMetadataTargets().filter((item) => !exportMetadata.has(item.id));
  if (!targets.length) {
    $("export-meta-state").textContent = "No unidentified titles remain.";
    return;
  }
  exportLookupInFlight = true;
  updateExportReadiness();
  let resolved = 0, unmatched = 0;
  try {
    // The user initiates each lookup; no private watch timestamps or Nuvio tokens are sent.
    for (let i = 0; i < targets.length; i += 3) {
      const group = targets.slice(i, i + 3);
      const responses = await Promise.all(group.map(async (target) => {
        try {
          return { target, metadata: await resolveMetadata(target.item, { tmdbReadAccessToken: token }) };
        } catch { return { target, metadata: null }; }
      }));
      for (const { target, metadata } of responses) {
        const key = String(target.item.content_id).toLowerCase();
        if (metadata?.name && !/^(tt\d+|tmdb:\d+)$/i.test(metadata.name)) {
          exportMetadata.set(key, metadata);
          if (target.id.includes("|s") && metadata.episodeTitle) exportMetadata.set(target.id, metadata);
          resolved++;
        } else unmatched++;
      }
      $("export-meta-state").textContent = "Checked " + Math.min(i + group.length, targets.length) + " of " + targets.length + " title/episode lookups…";
    }
    $("export-meta-state").textContent = "Resolved " + resolved + " lookups; " + unmatched + " unmatched. Unresolved IDs stay visible for review.";
    renderExportPreview();
  } finally {
    if (input) input.value = "";
    exportLookupInFlight = false;
    updateExportReadiness();
  }
}

function renderExportSourceSummary() {
  const box = $("export-source-summary");
  if (!box) return;
  if (!exportArchiveTextFiles) {
    box.hidden = true;
    return;
  }
  try {
    const plan = buildImportPlan(new Map([...exportArchiveTextFiles].map(([path, text]) => [path.split("/").pop(), text])));
    box.textContent = "Original Trakt archive: " + formatNumber(plan.sourceSummary.historyPlays) + " history plays, " + formatNumber(plan.sourceSummary.watchlistEntries) + " watchlist items, and " + formatNumber(plan.sourceSummary.playbackEntries) + " playback positions. All unrelated Trakt files are preserved.";
  } catch {
    box.textContent = "Original Trakt archive loaded with " + formatNumber(exportArchiveTextFiles.size) + " JSON files. Unrelated files will be preserved.";
  }
  box.hidden = false;
}

async function onExportZipSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const button = $("export-button");
  button.disabled = true;
  setStatus("Reading the original Trakt archive locally…");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    exportArchiveFiles = unzipSync(bytes);
    exportArchiveTextFiles = exportJsonTextFiles(exportArchiveFiles);
    if (!exportArchiveTextFiles.size) throw new Error("No JSON files were found in this ZIP.");
    exportMergeResult = null;
    exportCandidates = null;
    exportExcludedChanges.clear();
    exportMetadata.clear();
    exportEpisodeIds.clear();
    traktLivePlan = null;
    renderExportSourceSummary();
    renderExportPreview();
    updateExportReadiness();
    setStatus("Original Trakt archive is ready. It stays entirely in this browser.", "success");
  } catch (error) {
    exportArchiveFiles = null;
    exportArchiveTextFiles = null;
    exportMergeResult = null;
    exportCandidates = null;
    exportExcludedChanges.clear();
    exportMetadata.clear();
    exportEpisodeIds.clear();
    traktLivePlan = null;
    updateExportReadiness();
    setStatus("Could not read this Trakt ZIP: " + (error.message || error), "error");
  }
}

function renderExportPreview() {
  const panel = $("export-preview");
  if (!panel) return;
  if (!exportArchiveTextFiles || !state.remoteBefore) {
    panel.hidden = true;
    exportMergeResult = null;
    return;
  }
  try {
    exportCandidates = buildMergedTraktExport(exportArchiveTextFiles, state.remoteBefore, { metadata: exportMetadata });
    exportMergeResult = buildMergedTraktExport(exportArchiveTextFiles, state.remoteBefore, { metadata: exportMetadata, excluded: exportExcludedChanges });
    const summary = exportMergeResult.summary;
    $("export-count-watchlist").textContent = formatNumber(summary.watchlistAdded);
    $("export-count-watched").textContent = formatNumber(summary.watchedAdded);
    $("export-count-progress").textContent = formatNumber(summary.playbackAdded + summary.playbackUpdated);
    $("export-count-finished").textContent = formatNumber(summary.playbackRemovedBecauseFinished);
    $("export-final-history").textContent = formatNumber(summary.finalHistoryPlays);
    $("export-final-watchlist").textContent = formatNumber(summary.finalWatchlist);
    $("export-final-progress").textContent = formatNumber(summary.finalPlayback);
    renderExportExactChanges(exportCandidates);
    const proposed = exportAllCandidateRows();
    const selected = proposed.filter((row) => !exportExcludedChanges.has(row.id)).length;
    $("export-selection-status").textContent = formatNumber(selected) + " of " + formatNumber(proposed.length) + " proposed changes included in the ZIP.";
    const warning = $("export-warnings");
    warning.textContent = exportMergeResult.warnings.join(" ");
    warning.hidden = exportMergeResult.warnings.length === 0;
    panel.hidden = false;
    traktLivePlan = null;
    updateTraktSyncUi();
    renderTraktImportReadiness();
    updateExportReadiness();
  } catch (error) {
    exportMergeResult = null;
    exportCandidates = null;
    exportImportPreview = null;
    traktLivePlan = null;
    updateTraktSyncUi();
    panel.hidden = false;
    $("export-warnings").hidden = false;
    $("export-warnings").textContent = "The merge preview could not be built safely: " + (error.message || error);
  }
}

function selectedTraktFormat() {
  return document.querySelector('input[name="reverse-file-format"]:checked')?.value === "import" ? "import" : "archive";
}

function renderTraktImportReadiness() {
  const isImport = selectedTraktFormat() === "import";
  $("export-import-options").hidden = !isImport;
  $("export-button").textContent = isImport ? "Download Trakt import JSON (.json)" : "Download merged Trakt archive (.zip)";
  if (!isImport || !exportMergeResult || !exportArchiveTextFiles) {
    exportImportPreview = null;
    return;
  }
  try {
    const scope = $("export-import-full").checked ? "all" : "new";
    exportImportPreview = buildTraktImportJson(exportArchiveTextFiles, exportMergeResult, {
      scope, excluded: exportExcludedChanges, episodeIds: exportEpisodeIds,
    });
    const count = exportImportPreview.summary;
    const missing = exportImportPreview.unresolved;
    const missingEpisodes = missing.filter((row) => row.reason === "Episode-specific ID required");
    const unmatchedPanel = $("export-import-unmatched");
    unmatchedPanel.hidden = !missing.length;
    const unmatchedList = $("export-import-unmatched-list");
    unmatchedList.replaceChildren();
    for (const record of missing) {
      const li = document.createElement("li");
      const label = record.title + (record.season == null ? "" : " · S" + String(record.season).padStart(2, "0") + "E" + String(record.episode).padStart(2, "0"));
      li.textContent = label + " — " + record.reason;
      unmatchedList.append(li);
    }
    $("export-episode-status").textContent =
      count.history + " watched events (" + count.episodes + " individual episodes), " +
      count.watchlist + " watchlist entries ready for JSON. " +
      (missing.length ? missing.length + " unmatched, including " + missingEpisodes.length +
        " episodes. Resolve or exclude them before downloading." : "All IDs and dates are valid.");
    $("export-resolve-episodes").disabled = exportEpisodeLookupInFlight || !missingEpisodes.length;
    const skip = $("export-skip-unmatched");
    skip.hidden = !missing.length || scope === "all" || !missing.some((item) => item.changeId);
    skip.disabled = exportEpisodeLookupInFlight;
  } catch (error) {
    exportImportPreview = null;
    $("export-episode-status").textContent = "Cannot validate Trakt import: " + (error.message || error);
    $("export-resolve-episodes").disabled = true;
    $("export-skip-unmatched").hidden = true;
  }
}

async function resolveMissingTraktEpisodes() {
  if (exportEpisodeLookupInFlight || !exportImportPreview) return;
  const field = $("export-metadata-token");
  let token = String(field?.value || "").trim();
  if (field) field.value = "";
  if (!token) {
    $("export-episode-status").textContent = "Paste your TMDB API Read Access Token above, then click Resolve missing episode IDs.";
    return;
  }
  const missing = exportImportPreview.unresolved.filter((row) => row.reason === "Episode-specific ID required" && row.showIds);
  const groups = new Map();
  for (const row of missing) {
    const ids = row.showIds;
    const showKey = ids.imdb ? "imdb:" + String(ids.imdb).toLowerCase() : ids.tmdb ? "tmdb:" + ids.tmdb : "";
    const groupKey = showKey + "|s" + Number(row.season);
    if (!showKey) continue;
    const contentId = ids.imdb || (ids.tmdb ? "tmdb:" + ids.tmdb : "");
    if (!contentId) continue;
    if (!groups.has(groupKey)) groups.set(groupKey, {
      ids, showKey, contentId, season:Number(row.season), episodeNumbers:new Set(),
    });
    groups.get(groupKey).episodeNumbers.add(Number(row.episode));
  }
  exportEpisodeLookupInFlight = true;
  updateExportReadiness();
  const showCache = new Map();
  let resolved = 0, missed = 0;
  try {
    const targets = [...groups.values()];
    // Fetch each TV season once; use only public show ID + season number in requests.
    for (let i = 0; i < targets.length; i += 2) {
      const answers = await Promise.all(targets.slice(i,i+2).map(async (item) => {
        try {
          const cacheId = showCache.get(item.showKey);
          const found = await resolveTmdbSeasonEpisodeIds({
            content_id:item.contentId, content_type:"series", season:item.season,
            _ids:{ tmdb:cacheId || item.ids.tmdb },
          }, { tmdbReadAccessToken:token });
          return {item,found};
        } catch { return {item,found:null}; }
      }));
      for (const {item,found} of answers) {
        if (found?.showTmdbId) showCache.set(item.showKey, found.showTmdbId);
        const episodesByNumber = new Map((found?.episodes || []).map((episode) => [episode.episode, episode]));
        for (const episode of item.episodeNumbers) {
          const matched = episodesByNumber.get(episode);
          if (!matched?.ids?.tmdb) { missed++; continue; }
          for (const [service,id] of Object.entries(item.ids)) {
            if (!["imdb","tmdb","trakt","tvdb"].includes(service) || !id) continue;
            exportEpisodeIds.set(service + ":" + String(id).toLowerCase() + "|s" + item.season + "e" + episode, matched.ids);
          }
          if (matched.episodeTitle) {
            exportMetadata.set(String(item.contentId).toLowerCase() + "|s" + item.season + "e" + episode, {
              episodeTitle:matched.episodeTitle,
            });
          }
          resolved++;
        }
      }
      $("export-episode-status").textContent = "Resolved " + resolved + " episode IDs; " + missed +
        " unmatched. Checked " + Math.min(i+2, targets.length) + "/" + targets.length + " TV seasons…";
    }
    renderExportPreview();
    $("export-episode-status").textContent = resolved + " episode IDs resolved; " + missed + " unmatched. " +
      (exportImportPreview?.unresolved?.length || 0) +
      " total unmatched records remain. No whole-show fallback is used.";
  } finally {
    token = "";
    if (field) field.value = "";
    exportEpisodeLookupInFlight = false;
    renderTraktImportReadiness();
    updateExportReadiness();
  }
}

function skipUnmatchedTraktChanges() {
  if (!exportImportPreview || $("export-import-full").checked) return;
  for (const row of exportImportPreview.unresolved) if (row.changeId) exportExcludedChanges.add(row.changeId);
  renderExportPreview();
}

function downloadTraktWebImport() {
  const result = buildTraktImportJson(exportArchiveTextFiles, exportMergeResult, {
    scope: $("export-import-full").checked ? "all" : "new",
    excluded: exportExcludedChanges, episodeIds: exportEpisodeIds,
  });
  if (result.unresolved.length) throw new Error("Refusing to export " + result.unresolved.length +
    " unmatched items. Resolve episode IDs or explicitly exclude unmatched entries.");
  if (!result.rows.length) throw new Error("No selected watched events or watchlist additions.");
  const date = new Date().toISOString().slice(0, 10);
  const scope = $("export-import-full").checked ? "Full" : "New-Only";
  downloadBytes("Trakt-Nuvio-Import-" + scope + "-" + date + ".json",
    new TextEncoder().encode(JSON.stringify(result.rows, null, 2)), "application/json");
  setStatus("Trakt import JSON downloaded with " + result.summary.history + " watches (" +
    result.summary.episodes + " episodes) and " + result.summary.watchlist +
    " watchlist additions. Upload this JSON in Trakt's JSON File import option.", "success");
}

function updateTraktSyncUi() {
  const authorized = Boolean(traktConnection && traktConnection.expiresAt>Date.now());
  const ready = Boolean(authorized && exportMergeResult && exportArchiveTextFiles && state.remoteBefore);
  $("trakt-authorize").disabled = traktBusy || authorized;
  $("trakt-check").disabled = traktBusy || !ready;
  $("trakt-commit").disabled = traktBusy || !traktLivePlan;
  $("trakt-disconnect").disabled = traktBusy || !authorized;
  $("trakt-live-plan").hidden = !traktLivePlan;
  if (!authorized && !traktBusy) $("trakt-connect-status").textContent = "Not connected to Trakt.";
}

function traktCallbackToOpener() {
  const params = new URLSearchParams(window.location.search);
  if (!window.opener || (!params.has("code") && !params.has("error"))) return;
  const payload = {type:"nuvio-trakt-oauth-response",code:params.get("code"),
    state:params.get("state"),error:params.get("error")};
  if (!params.get("state")) return;
  window.opener.postMessage(payload,window.location.origin);
  history.replaceState(null,"",window.location.pathname);
  window.close();
}

async function authorizeTraktDirect() {
  if (traktBusy) return;
  const clientId=String($("trakt-client-id").value||"").trim();
  // Open the popup synchronously from a user click, before awaiting crypto.subtle.
  const popup=window.open("about:blank","nuvio-trakt-oauth","width=620,height=760");
  if (!popup) {
    $("trakt-connect-status").textContent="Your browser blocked the Trakt login popup. Allow popups and retry.";
    return;
  }
  traktBusy=true;
  updateTraktSyncUi();
  try {
    const redirectUri=window.location.origin+window.location.pathname;
    const auth=await createTraktAuthorization({clientId,redirectUri});
    traktAuthAttempt={...auth,popup};
    popup.location.href=auth.url;
    $("trakt-connect-status").textContent="Authorize the requested access in the Trakt popup. Keep this tab open.";
  } catch(error) {
    popup.close();
    traktAuthAttempt=null;
    $("trakt-connect-status").textContent="Could not start Trakt authorization: "+(error.message||error);
    traktBusy=false;
    updateTraktSyncUi();
  }
}

async function receiveTraktAuth(event) {
  if (event.origin!==window.location.origin || event.data?.type!=="nuvio-trakt-oauth-response")return;
  const pending=traktAuthAttempt;
  if (!pending || event.source!==pending.popup || event.data.state!==pending.state) return;
  traktAuthAttempt=null;
  try { pending.popup.close(); } catch {}
  try {
    if(event.data.error)throw Error("Trakt denied sign-in: "+event.data.error);
    const token=await exchangeTraktCode({code:event.data.code,verifier:pending.verifier,
      clientId:pending.clientId,redirectUri:pending.redirectUri});
    traktConnection={clientId:pending.clientId,...token};
    traktLivePlan=null;
    $("trakt-connect-status").textContent="Trakt authorized for this browser tab. Compare with live Trakt before syncing.";
  } catch(error) {
    traktConnection=null;
    $("trakt-connect-status").textContent="Authorization failed: "+(error.message||error)+
      ". Check your Trakt app's CORS origin and exact callback URL.";
  } finally {
    traktBusy=false;
    updateTraktSyncUi();
  }
}

function disconnectTraktDirect() {
  traktConnection=null;
  traktAuthAttempt=null;
  traktLivePlan=null;
  $("trakt-client-id").value="";
  $("trakt-connect-status").textContent="Disconnected. No Trakt token was saved.";
  updateTraktSyncUi();
}

function syncCandidatesNow() {
  if(!exportArchiveTextFiles||!exportMergeResult)throw Error("Read Nuvio data and build the merged preview first.");
  return buildTraktSyncCandidates(exportArchiveTextFiles,exportMergeResult,{
    excluded:exportExcludedChanges,episodeIds:exportEpisodeIds,
  });
}

async function compareTraktDirect() {
  if (traktBusy || !traktConnection) return;
  traktBusy=true;
  traktLivePlan=null;
  updateTraktSyncUi();
  try {
    const candidates=syncCandidatesNow();
    if(candidates.unresolved.length){
      const samples=candidates.unresolved.slice(0,4).map(row=>
        row.title+(row.season!=null?" S"+row.season+"E"+row.episode:"")+": "+row.reason).join("; ");
      throw Error(candidates.unresolved.length+" selected items lack a safe media ID. Resolve missing episode IDs (in JSON mode) or uncheck those items first. "+samples);
    }
    const api=makeTraktApi(traktConnection);
    const {body:profile}=await api("/users/settings");
    const user=profile?.user?.username || profile?.user?.name || "your Trakt account";
    const plan=await planTraktSync(api,candidates);
    traktLivePlan={plan,user,sourceRevision:exportMergeResult};
    const counts=plan;
    $("trakt-plan-counts").textContent="Trakt account: "+user+
      " · "+counts.history.length+" new watched events, "+
      counts.watchlist.length+" new watchlist titles, "+
      counts.playback.length+" newer playback positions. Already on Trakt: "+
      counts.existingSkipped.history+" watches, "+counts.existingSkipped.watchlist+
      " watchlist entries, "+counts.existingSkipped.playback+" resume positions.";
    $("trakt-connect-status").textContent="Live comparison complete. Review the counts and confirm separately before any changes.";
  } catch(error) {
    $("trakt-connect-status").textContent="Live Trakt comparison failed: "+(error.message||error)+
      ". No changes were sent to Trakt. Ensure your app's CORS origin is set correctly.";
  } finally {
    traktBusy=false;
    updateTraktSyncUi();
  }
}

async function commitTraktDirect() {
  if (traktBusy || !traktConnection || !traktLivePlan) return;
  const {plan,user}=traktLivePlan;
  const total=plan.history.length+plan.watchlist.length+plan.playback.length;
  if(!total){
    $("trakt-connect-status").textContent="Nothing new to sync: Trakt already has the selected data.";
    return;
  }
  const approved=window.confirm("Sync to "+user+"? Add "+plan.history.length+
    " watched events, "+plan.watchlist.length+" watchlist titles and "+plan.playback.length+
    " resume positions. No Trakt data will be deleted. This may not be reversible.");
  if (!approved) return;
  traktBusy=true;
  traktLivePlan=null; // a plan is consumed once, even on partial error; recompare before retrying
  updateTraktSyncUi();
  let last={history:0,watchlist:0,playback:0};
  try {
    const api=makeTraktApi(traktConnection);
    const report=await executeTraktSync(api,plan,{onProgress:progress=>{
      last=progress;
      $("trakt-connect-status").textContent="Trakt sync in progress: "+
        last.history+" watches, "+last.watchlist+" watchlist, "+last.playback+" playback positions confirmed.";
    }});
    $("trakt-connect-status").textContent="Trakt confirmed "+report.history+" watched events, "+
      report.watchlist+" watchlist entries and "+report.playback+" playback positions. "+
      (report.notFound.length?report.notFound.length+" items were not found by Trakt; check and retry after correcting IDs.":"No unmatched items reported.");
  } catch(error) {
    $("trakt-connect-status").textContent="Sync stopped after a Trakt API error: "+(error.message||error)+
      ". Confirmed so far: "+last.history+" watches, "+last.watchlist+" watchlist, "+
      last.playback+" playback positions. Run Compare again before retrying; never blindly resend.";
  } finally {
    traktBusy=false;
    updateTraktSyncUi();
  }
}

function updateExportReadiness() {
  const button = $("export-button");
  if (!button) return;
  const ready = Boolean(exportArchiveFiles && exportArchiveTextFiles && state.token && state.remoteBefore && state.selectedProfile && exportMergeResult);
  const jsonReady = selectedTraktFormat() !== "import" || Boolean(exportImportPreview && exportImportPreview.unresolved.length === 0 && exportImportPreview.rows.length);
  button.disabled = exportLookupInFlight || exportEpisodeLookupInFlight || !ready || !jsonReady;
  if ($("export-resolve-button")) $("export-resolve-button").disabled = exportLookupInFlight || !exportCandidates;
}

function downloadBytes(filename, bytes, type = "application/zip") {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadMergedTraktArchive() {
  if (selectedTraktFormat() === "import") {
    try { downloadTraktWebImport(); } catch (error) { setStatus("Import JSON export stopped: " + (error?.message || error), "error"); }
    return;
  }
  if (!exportArchiveFiles || !exportArchiveTextFiles || !state.remoteBefore) return;
  const button = $("export-button");
  setBusy(button, true, "Building merged archive…");
  try {
    const result = buildMergedTraktExport(exportArchiveTextFiles, state.remoteBefore, { metadata: exportMetadata, excluded: exportExcludedChanges });
    const mergedFiles = { ...exportArchiveFiles };
    for (const [path, text] of result.updates) mergedFiles[path] = strToU8(text);
    const zip = zipSync(mergedFiles, { level: 6 });
    const date = new Date().toISOString().slice(0, 10);
    downloadBytes("Trakt-Nuvio-Merged-" + date + ".zip", zip);
    exportMergeResult = result;
    setStatus("Merged Trakt archive downloaded. Added " + formatNumber(result.summary.watchedAdded) + " newer watched states and " + formatNumber(result.summary.watchlistAdded) + " Nuvio Library item(s) to the Trakt watchlist.", "success");
  } catch (error) {
    setStatus("Export stopped: " + (error.message || error), "error");
  } finally {
    setBusy(button, false);
    updateExportReadiness();
  }
}

const importerSections = [...document.querySelectorAll("main > section")];
const exporterWorkflow = $("exporter-workflow");
const heroHeading = document.querySelector(".hero h1");
const heroCopy = document.querySelector(".hero > p");
const originalHeroHeading = heroHeading?.innerHTML || "";
const originalHeroCopy = heroCopy?.textContent || "";
const loginPanel = $("login-panel");
const profilePanel = $("profile-panel");
const remoteSummary = $("remote-summary");
const loginHome = loginPanel?.parentElement;
const profileHome = profilePanel?.parentElement;
const remoteHome = remoteSummary?.parentElement;
const loginNext = loginPanel?.nextSibling || null;
const profileNext = profilePanel?.nextSibling || null;
const remoteNext = remoteSummary?.nextSibling || null;

function restoreNode(node, parent, next) {
  if (!node || !parent) return;
  parent.insertBefore(node, next && next.parentNode === parent ? next : null);
}

function setToolMode(mode) {
  activeTool = mode === "export" ? "export" : "import";
  const exporting = activeTool === "export";
  importerSections.forEach((section) => {
    section.hidden = exporting;
    section.style.display = exporting ? "none" : "";
    section.setAttribute("aria-hidden", exporting ? "true" : "false");
  });
  if (exporterWorkflow) {
    exporterWorkflow.hidden = !exporting;
    exporterWorkflow.style.display = exporting ? "" : "none";
    exporterWorkflow.setAttribute("aria-hidden", exporting ? "false" : "true");
  }
  $("tool-import-tab")?.setAttribute("aria-selected", exporting ? "false" : "true");
  $("tool-export-tab")?.setAttribute("aria-selected", exporting ? "true" : "false");
  $("tool-import-tab")?.classList.toggle("active", !exporting);
  $("tool-export-tab")?.classList.toggle("active", exporting);

  if (exporting) {
    if (heroHeading) heroHeading.innerHTML = "Nuvio Sync <span>→</span> Trakt";
    if (heroCopy) heroCopy.textContent = "Merge your current Nuvio watch history, Continue Watching state, and Library into an original Trakt export without touching ratings, personal lists, or other Trakt-specific records.";
    if (loginPanel) $("export-login-slot")?.append(loginPanel);
    if (profilePanel) $("export-profile-slot")?.append(profilePanel);
    if (remoteSummary) $("export-remote-slot")?.append(remoteSummary);
    if (state.token && $("export-login-button")) { $("export-login-button").textContent = "Nuvio Sync connected"; $("export-login-button").disabled = true; }
    renderExportSourceSummary();
    renderExportPreview();
    updateExportReadiness();
  } else {
    if (heroHeading) heroHeading.innerHTML = originalHeroHeading;
    if (heroCopy) heroCopy.textContent = originalHeroCopy;
    restoreNode(loginPanel, loginHome, loginNext);
    restoreNode(profilePanel, profileHome, profileNext);
    restoreNode(remoteSummary, remoteHome, remoteNext);
  }
  setStatus("");
}

$("tool-import-tab")?.addEventListener("click", () => setToolMode("import"));
$("tool-export-tab")?.addEventListener("click", () => setToolMode("export"));
$("export-zip-input")?.addEventListener("change", onExportZipSelected);
$("export-login-button")?.addEventListener("click", startLogin);
$("export-button")?.addEventListener("click", downloadMergedTraktArchive);
$("trakt-authorize")?.addEventListener("click", authorizeTraktDirect);
$("trakt-check")?.addEventListener("click", compareTraktDirect);
$("trakt-commit")?.addEventListener("click", commitTraktDirect);
$("trakt-disconnect")?.addEventListener("click", disconnectTraktDirect);
window.addEventListener("message",receiveTraktAuth);
traktCallbackToOpener();

for (const input of document.querySelectorAll('input[name="reverse-file-format"]')) {
  input.addEventListener("change", () => { renderTraktImportReadiness(); updateExportReadiness(); });
}
$("export-import-full")?.addEventListener("change", () => { renderTraktImportReadiness(); updateExportReadiness(); });
$("export-resolve-episodes")?.addEventListener("click", resolveMissingTraktEpisodes);
$("export-skip-unmatched")?.addEventListener("click", skipUnmatchedTraktChanges);
$("export-resolve-button")?.addEventListener("click", exportResolveTitles);
$("export-select-all")?.addEventListener("click", () => { exportExcludedChanges.clear(); renderExportPreview(); });
$("export-select-none")?.addEventListener("click", () => { for (const row of exportAllCandidateRows()) exportExcludedChanges.add(row.id); renderExportPreview(); });
$("profile-select")?.addEventListener("change", () => {
  if (activeTool === "export") {
    state.remoteBefore = null;
    state.selectedProfile = null;
    exportExcludedChanges.clear();
    exportMetadata.clear();
    exportEpisodeIds.clear();
    exportCandidates = null;
    traktLivePlan = null;
    updateTraktSyncUi();
    $("remote-summary").hidden = true;
    setStatus("Profile changed. Click Read Nuvio data to load the selected profile.");
  }
  exportMergeResult = null;
  renderExportPreview();
  updateExportReadiness();
});
setToolMode("import");
updateTraktSyncUi();

window.addEventListener("beforeunload", () => {
`,
    "exporter workflow",
  );

  return patched;
}
