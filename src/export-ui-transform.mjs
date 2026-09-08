function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Expected ${label} block was not found`);
  return source.replace(needle, replacement);
}

export function patchExportUiSource(source) {
  let patched = `import { zipSync, strToU8 } from "fflate";\nimport { buildMergedTraktExport } from "./trakt-exporter.mjs";\n${source}`;

  patched = replaceRequired(
    patched,
    "const state = {\n",
    `let activeTool = "import";
let exportArchiveFiles = null;
let exportArchiveTextFiles = null;
let exportMergeResult = null;

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

function exportPopulateChangeList(listId, countId, rows, emptyText) {
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
  for (const text of rows) {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  }
}

function exportCollectExactChanges(result) {
  const changes = { watchlist: [], history: [], playback: [] };
  for (const [path, text] of result?.updates || []) {
    const base = exportBasename(path).toLowerCase();
    let after = [];
    try {
      const parsed = JSON.parse(text);
      after = Array.isArray(parsed) ? parsed : [];
    } catch {
      continue;
    }
    const before = exportReadArray(exportArchiveTextFiles, path);

    if (base === "lists-watchlist.json") {
      const beforeKeys = new Set(before.map(exportEntryIdentity).filter(Boolean));
      for (const entry of after) {
        const key = exportEntryIdentity(entry);
        if (!key || beforeKeys.has(key)) continue;
        const type = entry?.movie ? "Movie" : "Show";
        changes.watchlist.push(type + " · " + exportTitleLabel(entry) + " · listed " + exportFormatTimestamp(entry?.listed_at));
      }
      continue;
    }

    if (/^watched-history-\\d+\\.json$/i.test(base)) {
      const beforeKeys = new Set(before.map(exportHistoryIdentity).filter(Boolean));
      for (const entry of after) {
        const key = exportHistoryIdentity(entry);
        if (!key || beforeKeys.has(key)) continue;
        const type = entry?.type === "episode" ? "Episode" : "Movie";
        changes.history.push(type + " · " + exportTitleLabel(entry) + " · watched " + exportFormatTimestamp(entry?.watched_at));
      }
      continue;
    }

    if (base === "watched-playback.json") {
      const beforeMap = new Map(before.map((entry) => [exportEntryIdentity(entry), entry]).filter(([key]) => key));
      const afterMap = new Map(after.map((entry) => [exportEntryIdentity(entry), entry]).filter(([key]) => key));
      for (const [key, entry] of afterMap) {
        const previous = beforeMap.get(key);
        const currentProgress = Number(entry?.progress || 0);
        if (!previous) {
          changes.playback.push("Added · " + exportTitleLabel(entry) + " · " + currentProgress.toFixed(1) + "% · paused " + exportFormatTimestamp(entry?.paused_at));
          continue;
        }
        const previousProgress = Number(previous?.progress || 0);
        const changed = previousProgress !== currentProgress || String(previous?.paused_at || "") !== String(entry?.paused_at || "");
        if (changed) {
          changes.playback.push("Updated · " + exportTitleLabel(entry) + " · " + previousProgress.toFixed(1) + "% → " + currentProgress.toFixed(1) + "% · paused " + exportFormatTimestamp(entry?.paused_at));
        }
      }
      for (const [key, entry] of beforeMap) {
        if (afterMap.has(key)) continue;
        changes.playback.push("Cleared after newer finished state · " + exportTitleLabel(entry) + " · was " + Number(entry?.progress || 0).toFixed(1) + "% · paused " + exportFormatTimestamp(entry?.paused_at));
      }
    }
  }
  return changes;
}

function renderExportExactChanges(result) {
  const changes = exportCollectExactChanges(result);
  exportPopulateChangeList("export-detail-watchlist", "export-detail-watchlist-count", changes.watchlist, "No new Nuvio Library items need to be added to the Trakt watchlist.");
  exportPopulateChangeList("export-detail-history", "export-detail-history-count", changes.history, "No newer watched states need to be added to Trakt history.");
  exportPopulateChangeList("export-detail-playback", "export-detail-playback-count", changes.playback, "No Continue Watching positions need to change.");
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
    renderExportSourceSummary();
    renderExportPreview();
    updateExportReadiness();
    setStatus("Original Trakt archive is ready. It stays entirely in this browser.", "success");
  } catch (error) {
    exportArchiveFiles = null;
    exportArchiveTextFiles = null;
    exportMergeResult = null;
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
    exportMergeResult = buildMergedTraktExport(exportArchiveTextFiles, state.remoteBefore);
    const summary = exportMergeResult.summary;
    $("export-count-watchlist").textContent = formatNumber(summary.watchlistAdded);
    $("export-count-watched").textContent = formatNumber(summary.watchedAdded);
    $("export-count-progress").textContent = formatNumber(summary.playbackAdded + summary.playbackUpdated);
    $("export-count-finished").textContent = formatNumber(summary.playbackRemovedBecauseFinished);
    $("export-final-history").textContent = formatNumber(summary.finalHistoryPlays);
    $("export-final-watchlist").textContent = formatNumber(summary.finalWatchlist);
    $("export-final-progress").textContent = formatNumber(summary.finalPlayback);
    renderExportExactChanges(exportMergeResult);
    const warning = $("export-warnings");
    warning.textContent = exportMergeResult.warnings.join(" ");
    warning.hidden = exportMergeResult.warnings.length === 0;
    panel.hidden = false;
  } catch (error) {
    exportMergeResult = null;
    panel.hidden = false;
    $("export-warnings").hidden = false;
    $("export-warnings").textContent = "The merge preview could not be built safely: " + (error.message || error);
  }
}

function updateExportReadiness() {
  const button = $("export-button");
  if (!button) return;
  button.disabled = !(exportArchiveFiles && exportArchiveTextFiles && state.token && state.remoteBefore && state.selectedProfile && exportMergeResult);
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
  if (!exportArchiveFiles || !exportArchiveTextFiles || !state.remoteBefore) return;
  const button = $("export-button");
  setBusy(button, true, "Building merged archive…");
  try {
    const result = buildMergedTraktExport(exportArchiveTextFiles, state.remoteBefore);
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
$("profile-select")?.addEventListener("change", () => {
  exportMergeResult = null;
  renderExportPreview();
  updateExportReadiness();
});
setToolMode("import");

window.addEventListener("beforeunload", () => {
`,
    "exporter workflow",
  );

  return patched;
}
