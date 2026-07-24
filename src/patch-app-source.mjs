function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Could not patch ${label}: expected source block was not found`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`Could not patch ${label}: source block was not unique`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

export function patchAppSource(source) {
  let output = source;
  output = replaceOnce(
    output,
    'import { unzipSync, strFromU8 } from "fflate";\n',
    'import { unzipSync, strFromU8 } from "fflate";\nimport { resolveMetadata, resolveTmdbMetadata } from "./metadata-provider.mjs";\nimport { buildImportStrategy, IMPORT_MODES, watchedDeleteKey, progressDeleteKey, libraryKey, watchedKey, progressKey } from "./import-strategies.mjs";\n',
    "metadata and strategy imports",
  );
  output = replaceOnce(
    output,
    '  metadataById: new Map(),\n',
    '  metadataById: new Map(),\n  tmdbReadAccessToken: null,\n',
    "in-memory TMDB token state",
  );
  output = replaceOnce(
    output,
    `async function fetchCinemeta(item) {\n  if (!item.content_id?.startsWith("tt")) return null;\n  const type = item.content_type === "movie" ? "movie" : "series";\n  const response = await fetch(\`${'${CINEMETA_BASE}'}/meta/${'${type}'}/${'${encodeURIComponent(item.content_id)}'}.json\`);\n  if (!response.ok) throw new Error(\`Cinemeta ${'${response.status}'}\`);\n  const body = await response.json();\n  return body?.meta ?? null;\n}\n`,
    `async function fetchCinemeta(item) {\n  return resolveMetadata(item, {\n    tmdbReadAccessToken: state.tmdbReadAccessToken || "",\n    cinemetaBase: CINEMETA_BASE,\n  });\n}\n\nfunction metadataKey(item) {\n  const season = Number(item.season);\n  const episode = Number(item.episode);\n  return item.content_type === "series" && Number.isInteger(season) && Number.isInteger(episode)\n    ? \`${'${item.content_id}'}:s${'${season}'}e${'${episode}'}\`\n    : item.content_id;\n}\n`,
    "metadata lookup",
  );
  output = replaceOnce(
    output,
    '    poster: meta?.poster || (imdbFallback ? `https://images.metahub.space/poster/small/${imdbFallback}/img` : item.poster),\n',
    '    poster: meta?.poster || item.poster,\n',
    "poster fallback",
  );
  output = replaceOnce(
    output,
    '    background: meta?.background || (imdbFallback ? `https://images.metahub.space/background/medium/${imdbFallback}/img` : item.background),\n',
    '    background: meta?.background || item.background,\n',
    "background fallback",
  );
  output = replaceOnce(
    output,
    '    addon_base_url: item.addon_base_url || `${CINEMETA_BASE}/manifest.json`,\n',
    '    addon_base_url: item.addon_base_url || (imdbFallback ? `${CINEMETA_BASE}/manifest.json` : null),\n',
    "TMDB-only addon source",
  );
  output = replaceOnce(
    output,
    '    setStatus("Please approve the metadata lookup first. Only public IMDb IDs are sent, never your ZIP, Nuvio account, timestamps, or ratings.", "error");\n',
    '    setStatus("Please approve the metadata lookup first. Only public media IDs and episode numbers are sent, never your ZIP, Nuvio account, timestamps, ratings, or playback percentages.", "error");\n',
    "metadata consent status",
  );
  output = replaceOnce(
    output,
    '  const button = $("metadata-button");\n  setBusy(button, true, "Resolving metadata…");\n  try {\n',
    '  const button = $("metadata-button");\n  state.tmdbReadAccessToken = $("tmdb-token")?.value.trim() || "";\n  setBusy(button, true, "Resolving metadata…");\n  try {\n',
    "capture user TMDB token",
  );
  output = replaceOnce(
    output,
    `    for (const item of [...state.plan.library, ...state.plan.progress]) {\n      if (!unique.has(item.content_id)) unique.set(item.content_id, item);\n    }\n`,
    `    for (const item of [...state.plan.library, ...state.plan.progress]) {\n      const key = metadataKey(item);\n      if (!unique.has(key)) unique.set(key, item);\n    }\n`,
    "metadata deduplication",
  );
  output = replaceOnce(
    output,
    '      if (result && !result.error) state.metadataById.set(items[index].content_id, result);\n',
    '      if (result && !result.error) state.metadataById.set(metadataKey(items[index]), result);\n',
    "metadata cache key",
  );
  output = replaceOnce(
    output,
    '    state.plan.library = state.plan.library.map((item) => hydrateLibraryItem(item, state.metadataById.get(item.content_id)));\n',
    '    state.plan.library = state.plan.library.map((item) => hydrateLibraryItem(item, state.metadataById.get(metadataKey(item))));\n',
    "library metadata key",
  );
  output = replaceOnce(
    output,
    '    state.plan.progress = state.plan.progress.map((item) => applyRuntime(item, parseMetaRuntime(state.metadataById.get(item.content_id))));\n',
    '    state.plan.progress = state.plan.progress.map((item) => applyRuntime(item, parseMetaRuntime(state.metadataById.get(metadataKey(item))));\n',
    "progress metadata key",
  );
  output = replaceOnce(
    output,
    '    $("metadata-state").textContent = state.unresolvedProgress.length\n      ? `${state.unresolvedProgress.length} resume item(s) still need a runtime.`\n      : `All ${state.plan.progress.length} resume positions have a runtime.`;\n',
    '    const providerNote = state.tmdbReadAccessToken\n      ? " TMDB was used first; Cinemeta was available only as fallback."\n      : " Cinemeta-only mode was used; artwork may be incomplete without TMDB.";\n    $("metadata-state").textContent = (state.unresolvedProgress.length\n      ? `${state.unresolvedProgress.length} resume item(s) still need a runtime.`\n      : `All ${state.plan.progress.length} resume positions have a runtime.`) + providerNote;\n    renderStrategyPreview();\n',
    "metadata provider status",
  );
  output = replaceOnce(
    output,
    '  } finally {\n    setBusy(button, false);\n  }\n}\n\nfunction applyManualRuntimes',
    '  } finally {\n    state.tmdbReadAccessToken = null;\n    if ($("tmdb-token")) $("tmdb-token").value = "";\n    setBusy(button, false);\n  }\n}\n\nfunction applyManualRuntimes',
    "clear TMDB token after lookup",
  );
  output = replaceOnce(
    output,
    'async function startLogin() {\n  if (!state.plan) return;\n  const button = $("login-button");\n',
    'async function startLogin() {\n  const button = $("login-button");\n',
    "allow repair-only Nuvio sign-in",
  );
  output = replaceOnce(
    output,
    '    state.remoteBefore = { library, watchedItems, watchProgress };\n    state.backupDownloaded = false;\n    $("backup-button").disabled = false;\n    $("remote-summary").hidden = false;\n    $("remote-summary").textContent = `Existing Nuvio data: ${formatNumber(library.length)} library items, ${formatNumber(watchedItems.length)} watched states, ${formatNumber(watchProgress.length)} progress items.`;\n    updateImportReadiness();\n',
    '    state.remoteBefore = { library, watchedItems, watchProgress };\n    state.backupDownloaded = false;\n    $("backup-button").disabled = false;\n    $("remote-summary").hidden = false;\n    $("remote-summary").textContent = `Existing Nuvio data: ${formatNumber(library.length)} library items, ${formatNumber(watchedItems.length)} watched states, ${formatNumber(watchProgress.length)} progress items.`;\n    $("strategy-panel").hidden = !state.plan;\n    $("artwork-repair-panel").hidden = false;\n    $("repair-artwork-button").disabled = true;\n    renderStrategyPreview();\n    updateDangerConfirmation();\n    updateImportReadiness();\n',
    "show strategy and repair panels",
  );
  output = replaceOnce(
    output,
    '  state.backupDownloaded = true;\n  updateImportReadiness();\n  setStatus("Backup downloaded. You can now start the import.", "success");\n',
    '  state.backupDownloaded = true;\n  if ($("repair-artwork-button")) $("repair-artwork-button").disabled = !(state.remoteBefore?.library?.length);\n  updateImportReadiness();\n  setStatus("Backup downloaded. Import and artwork repair actions are now available.", "success");\n',
    "enable protected write actions after backup",
  );
  output = replaceOnce(
    output,
    `function updateImportReadiness() {\n  const ready = Boolean(\n    state.plan &&\n    state.token &&\n    state.remoteBefore &&\n    state.backupDownloaded &&\n    state.unresolvedProgress.length === 0 &&\n    state.plan.progress.every((item) => item.duration > 0 && item.position > 0)\n  );\n  $("import-button").disabled = !ready;\n}\n`,
    `function selectedImportMode() {\n  return document.querySelector('input[name="import-mode"]:checked')?.value || IMPORT_MODES.MERGE_NEWER;\n}\n\nfunction confirmationWord(mode = selectedImportMode()) {\n  if (mode === IMPORT_MODES.MIRROR) return "MIRROR";\n  if (mode === IMPORT_MODES.FRESH) return "RESET";\n  return "";\n}\n\nfunction updateDangerConfirmation() {\n  const mode = selectedImportMode();\n  const word = confirmationWord(mode);\n  const panel = $("destructive-confirmation");\n  if (!panel) return;\n  panel.hidden = !word;\n  if (!word) {\n    $("danger-confirm-input").value = "";\n  } else {\n    $("danger-confirm-word").textContent = word;\n    $("danger-confirm-title").textContent = mode === IMPORT_MODES.FRESH ? "Fresh reset confirmation" : "Mirror confirmation";\n    $("danger-confirm-copy").textContent = mode === IMPORT_MODES.FRESH\n      ? "This clears the selected profile's Library, watched status, and Continue Watching data before rebuilding from Trakt. Add-ons, plugins, profile settings, and the profile itself are not targeted."\n      : "Items in these three tracking categories that are missing from the Trakt import will be removed from Nuvio.";\n  }\n  updateImportReadiness();\n}\n\nfunction currentStrategyPlan() {\n  if (!state.plan || !state.remoteBefore) return null;\n  return buildImportStrategy(selectedImportMode(), state.remoteBefore, {\n    library: state.plan.library,\n    watchedItems: state.plan.watchedItems,\n    progress: state.plan.progress,\n  });\n}\n\nfunction renderStrategyPreview() {\n  const box = $("strategy-preview");\n  if (!box || !state.plan || !state.remoteBefore) return;\n  const strategy = currentStrategyPlan();\n  const section = (label, values) => \`<div class="preview-card"><strong>${'${label}'}</strong><div class="preview-counts"><span class="add">+${'${values.added}'} add</span><span class="update">↻ ${'${values.updated}'} update</span><span class="remove">−${'${values.removed}'} remove</span><span class="final">${'${values.final}'} final</span></div></div>\`;\n  box.innerHTML = section("Library", strategy.preview.library) + section("Watched", strategy.preview.watched) + section("Continue Watching", strategy.preview.progress);\n}\n\nfunction updateImportReadiness() {\n  const word = confirmationWord();\n  const confirmed = !word || $("danger-confirm-input")?.value.trim().toUpperCase() === word;\n  const ready = Boolean(\n    state.plan &&\n    state.token &&\n    state.remoteBefore &&\n    state.backupDownloaded &&\n    confirmed &&\n    state.unresolvedProgress.length === 0 &&\n    state.plan.progress.every((item) => item.duration > 0 && item.position > 0)\n  );\n  $("import-button").disabled = !ready;\n}\n`,
    "strategy-aware import readiness",
  );

  const oldRunImport = `async function runImport() {\n  if (!state.plan || !state.remoteBefore || !state.selectedProfile) return;\n  const button = $("import-button");\n  setBusy(button, true, "Importing…");\n  button.disabled = true;\n  try {\n    const profileId = Number(state.selectedProfile.profile_index);\n    const importedLibrary = sanitizeLibrary(state.plan.library);\n    const importedWatched = sanitizeWatched(state.plan.watchedItems);\n    const importedProgress = sanitizeProgress(state.plan.progress);\n    const mergedLibrary = sanitizeLibrary(mergeLibrary(state.remoteBefore.library, importedLibrary));\n\n    setStatus(\`Uploading merged library (${'${formatNumber(mergedLibrary.length)}'} items)…\`);\n    await rpc("sync_push_library", {\n      p_items: mergedLibrary,\n      p_profile_id: profileId,\n      p_origin_client_id: state.importerClientId,\n    });\n\n    const watchedBatches = chunk(importedWatched, 350);\n    for (let index = 0; index < watchedBatches.length; index++) {\n      setStatus(\`Uploading watched states: batch ${'${index + 1}'}/${'${watchedBatches.length}'}…\`);\n      await rpc("sync_push_watched_items", {\n        p_items: watchedBatches[index],\n        p_profile_id: profileId,\n        p_origin_client_id: state.importerClientId,\n      });\n    }\n\n    const progressBatches = chunk(importedProgress, 300);\n    for (let index = 0; index < progressBatches.length; index++) {\n      setStatus(\`Uploading resume positions: batch ${'${index + 1}'}/${'${progressBatches.length}'}…\`);\n      await rpc("sync_push_watch_progress", {\n        p_entries: progressBatches[index],\n        p_profile_id: profileId,\n        p_origin_client_id: state.importerClientId,\n      });\n    }\n\n    setStatus("Verifying every imported record in Nuvio Sync…");\n    const [libraryAfter, watchedAfter, progressAfter] = await Promise.all([\n      pullLibrary(profileId),\n      pullWatched(profileId),\n      pullProgress(profileId),\n    ]);\n    const libraryKeys = new Set(libraryAfter.map((item) => \`${'${item.content_type}'}|${'${item.content_id}'}\`));\n    const watchedKeys = new Set(watchedAfter.map(keyWatched));\n    const progressKeys = new Set(progressAfter.map(keyProgress));\n    const missingLibrary = importedLibrary.filter((item) => !libraryKeys.has(\`${'${item.content_type}'}|${'${item.content_id}'}\`));\n    const missingWatched = importedWatched.filter((item) => !watchedKeys.has(keyWatched(item)));\n    const missingProgress = importedProgress.filter((item) => !progressKeys.has(keyProgress(item)));\n    if (missingLibrary.length || missingWatched.length || missingProgress.length) {\n      throw new Error(\`Verification found missing records (library ${'${missingLibrary.length}'}, watched ${'${missingWatched.length}'}, progress ${'${missingProgress.length}'}). The backup remains available and the audit has not been marked successful.\`);\n    }\n\n    const metadataResolved = state.plan.progress.length - state.unresolvedProgress.length;\n    const audit = buildAudit(state.plan, {\n      profile: state.selectedProfile,\n      metadata: {\n        provider: "Cinemeta (public IMDb metadata)",\n        resolvedContentIds: state.metadataById.size,\n        resumePositionsWithRuntime: metadataResolved,\n      },\n      remoteBefore: {\n        libraryItems: state.remoteBefore.library.length,\n        watchedItems: state.remoteBefore.watchedItems.length,\n        watchProgressItems: state.remoteBefore.watchProgress.length,\n      },\n      remoteAfter: {\n        libraryItems: libraryAfter.length,\n        watchedItems: watchedAfter.length,\n        watchProgressItems: progressAfter.length,\n        verifiedImportedLibraryItems: importedLibrary.length,\n        verifiedImportedWatchedItems: importedWatched.length,\n        verifiedImportedWatchProgressItems: importedProgress.length,\n      },\n    });\n    downloadJson(\`nuvio-trakt-import-audit-${'${new Date().toISOString().slice(0, 10)}'}.json\`, audit);\n    $("success-panel").hidden = false;\n    $("success-summary").textContent = \`Verified ${'${formatNumber(importedLibrary.length)}'} library items, ${'${formatNumber(importedWatched.length)}'} watched movie/episode states, and ${'${formatNumber(importedProgress.length)}'} resume positions in Nuvio Sync.\`;\n    setStatus("Import complete and verified. The audit report has been downloaded.", "success");\n  } catch (error) {\n    setStatus(\`Import stopped: ${'${error.message || error}'}\`, "error");\n    updateImportReadiness();\n  } finally {\n    setBusy(button, false);\n  }\n}\n`;

  const newRunImport = `async function deleteWatchedRemote(items, profileId) {\n  const keys = items.map(watchedDeleteKey).filter((item) => item.content_id);\n  for (const batch of chunk(keys, 300)) {\n    await rpc("sync_delete_watched_items", { p_profile_id: profileId, p_keys: batch, p_origin_client_id: state.importerClientId });\n  }\n}\n\nasync function deleteProgressRemote(items, profileId) {\n  const keys = items.map(progressDeleteKey).filter(Boolean);\n  for (const batch of chunk(keys, 300)) {\n    await rpc("sync_delete_watch_progress", { p_profile_id: profileId, p_keys: batch, p_origin_client_id: state.importerClientId });\n  }\n}\n\nasync function pushWatched(items, profileId) {\n  for (const batch of chunk(sanitizeWatched(items), 350)) {\n    await rpc("sync_push_watched_items", { p_items: batch, p_profile_id: profileId, p_origin_client_id: state.importerClientId });\n  }\n}\n\nasync function pushProgress(items, profileId) {\n  for (const batch of chunk(sanitizeProgress(items), 300)) {\n    await rpc("sync_push_watch_progress", { p_entries: batch, p_profile_id: profileId, p_origin_client_id: state.importerClientId });\n  }\n}\n\nfunction compareKeySets(actual, expected, keyFn) {\n  const actualKeys = new Set(actual.map(keyFn));\n  const expectedKeys = new Set(expected.map(keyFn));\n  return {\n    missing: [...expectedKeys].filter((key) => !actualKeys.has(key)),\n    extra: [...actualKeys].filter((key) => !expectedKeys.has(key)),\n  };\n}\n\nasync function verifyStrategyResult(strategy, profileId) {\n  const [libraryAfter, watchedAfter, progressAfter] = await Promise.all([pullLibrary(profileId), pullWatched(profileId), pullProgress(profileId)]);\n  const checks = [\n    ["library", compareKeySets(libraryAfter, strategy.library.target, libraryKey)],\n    ["watched", compareKeySets(watchedAfter, strategy.watched.target, watchedKey)],\n    ["progress", compareKeySets(progressAfter, strategy.progress.target, progressKey)],\n  ];\n  const failed = checks.filter(([, result]) => result.missing.length || result.extra.length);\n  if (failed.length) {\n    const detail = failed.map(([name, result]) => \`${'${name}'} missing=${'${result.missing.length}'} extra=${'${result.extra.length}'}\`).join(", ");\n    throw new Error(\`Verification did not match the selected strategy: ${'${detail}'}. Your pre-change backup is still available.\`);\n  }\n  return { libraryAfter, watchedAfter, progressAfter };\n}\n\nasync function clearTrackingData(profileId) {\n  setStatus("Fresh reset: clearing Nuvio Library…", "warning");\n  await rpc("sync_push_library", { p_items: [], p_profile_id: profileId, p_origin_client_id: state.importerClientId });\n  const libraryAfterClear = await pullLibrary(profileId);\n  if (libraryAfterClear.length) throw new Error("Nuvio did not accept an empty Library snapshot, so the fresh reset was stopped before watched/progress data was deleted.");\n  setStatus("Fresh reset: clearing watched status and Continue Watching…", "warning");\n  await deleteWatchedRemote(state.remoteBefore.watchedItems, profileId);\n  await deleteProgressRemote(state.remoteBefore.watchProgress, profileId);\n  const [watchedAfter, progressAfter] = await Promise.all([pullWatched(profileId), pullProgress(profileId)]);\n  if (watchedAfter.length || progressAfter.length) throw new Error(\`Fresh reset verification failed before rebuild (watched ${'${watchedAfter.length}'}, progress ${'${progressAfter.length}'}).\`);\n}\n\nasync function repairArtwork() {\n  if (!state.remoteBefore || !state.selectedProfile || !state.backupDownloaded) {\n    setStatus("Read Nuvio data and download the backup before repairing artwork.", "error");\n    return;\n  }\n  const tokenInput = $("repair-tmdb-token");\n  const token = tokenInput?.value.trim() || "";\n  if (!token) {\n    setStatus("Paste your own TMDB API Read Access Token to repair artwork.", "error");\n    return;\n  }\n  const button = $("repair-artwork-button");\n  setBusy(button, true, "Repairing artwork…");\n  try {\n    const source = state.remoteBefore.library;\n    const results = await mapConcurrent(source, 4, (item) => resolveTmdbMetadata(item, { tmdbReadAccessToken: token }), (done, total) => {\n      $("repair-state").textContent = \`Checking TMDB artwork: ${'${done}'}/${'${total}'}…\`;\n    });\n    let changed = 0;\n    let resolved = 0;\n    const repaired = source.map((item, index) => {\n      const result = results[index];\n      if (!result || result.error) return item;\n      if (result.poster || result.background) resolved++;\n      const next = { ...item, poster: result.poster || item.poster, background: result.background || item.background };\n      if (next.poster !== item.poster || next.background !== item.background) changed++;\n      return next;\n    });\n    if (!resolved) throw new Error("TMDB did not resolve artwork for any library item. Check that the token is valid and is an API Read Access Token.");\n    if (!changed) {\n      $("repair-state").textContent = \`TMDB checked ${'${resolved}'} compatible items; no artwork URLs needed changing.\`;\n      $("repair-state").dataset.kind = "success";\n      return;\n    }\n    const profileId = Number(state.selectedProfile.profile_index);\n    await rpc("sync_push_library", { p_items: sanitizeLibrary(repaired), p_profile_id: profileId, p_origin_client_id: state.importerClientId });\n    const libraryAfter = await pullLibrary(profileId);\n    const afterMap = new Map(libraryAfter.map((item) => [libraryKey(item), item]));\n    const failed = repaired.filter((item, index) => {\n      const result = results[index];\n      if (!result || result.error || (!result.poster && !result.background)) return false;\n      const remote = afterMap.get(libraryKey(item));\n      return !remote || (result.poster && remote.poster !== result.poster) || (result.background && remote.background !== result.background);\n    });\n    if (failed.length) throw new Error(\`Artwork verification failed for ${'${failed.length}'} item(s).\`);\n    state.remoteBefore = { ...state.remoteBefore, library: libraryAfter };\n    $("repair-state").textContent = \`Artwork repair verified: ${'${changed}'} library item(s) received updated TMDB poster/background URLs.\`;\n    $("repair-state").dataset.kind = "success";\n    renderStrategyPreview();\n    setStatus("Artwork repair complete and verified. Watched and Continue Watching data were not changed.", "success");\n  } catch (error) {\n    $("repair-state").textContent = \`Artwork repair stopped: ${'${error.message || error}'}\`;\n    $("repair-state").dataset.kind = "warning";\n    setStatus(\`Artwork repair stopped: ${'${error.message || error}'}\`, "error");\n  } finally {\n    if (tokenInput) tokenInput.value = "";\n    setBusy(button, false);\n  }\n}\n\nasync function runImport() {\n  if (!state.plan || !state.remoteBefore || !state.selectedProfile) return;\n  const strategy = currentStrategyPlan();\n  if (!strategy) return;\n  const button = $("import-button");\n  setBusy(button, true, "Applying strategy…");\n  button.disabled = true;\n  try {\n    const profileId = Number(state.selectedProfile.profile_index);\n    if (strategy.resetFirst) {\n      await clearTrackingData(profileId);\n    } else {\n      setStatus("Applying selected Library strategy…");\n      await rpc("sync_push_library", { p_items: sanitizeLibrary(strategy.library.target), p_profile_id: profileId, p_origin_client_id: state.importerClientId });\n      if (strategy.watched.deletes.length) {\n        setStatus(\`Removing ${'${strategy.watched.deletes.length}'} watched item(s) missing from the selected strategy…\`);\n        await deleteWatchedRemote(strategy.watched.deletes, profileId);\n      }\n      if (strategy.progress.deletes.length) {\n        setStatus(\`Removing ${'${strategy.progress.deletes.length}'} Continue Watching item(s) missing from the selected strategy…\`);\n        await deleteProgressRemote(strategy.progress.deletes, profileId);\n      }\n    }\n\n    if (strategy.resetFirst) {\n      setStatus("Rebuilding Library from Trakt…");\n      await rpc("sync_push_library", { p_items: sanitizeLibrary(strategy.library.target), p_profile_id: profileId, p_origin_client_id: state.importerClientId });\n    }\n    if (strategy.watched.upserts.length) {\n      setStatus(\`Writing ${'${strategy.watched.upserts.length}'} watched state(s)…\`);\n      await pushWatched(strategy.watched.upserts, profileId);\n    }\n    if (strategy.progress.upserts.length) {\n      setStatus(\`Writing ${'${strategy.progress.upserts.length}'} Continue Watching position(s)…\`);\n      await pushProgress(strategy.progress.upserts, profileId);\n    }\n\n    setStatus("Verifying Nuvio Sync against the selected strategy…");\n    const { libraryAfter, watchedAfter, progressAfter } = await verifyStrategyResult(strategy, profileId);\n    const metadataResolved = state.plan.progress.length - state.unresolvedProgress.length;\n    const audit = buildAudit(state.plan, {\n      profile: state.selectedProfile,\n      metadata: {\n        provider: "User-supplied TMDB primary when provided; Cinemeta runtime/metadata fallback; MetaHub artwork disabled",\n        resolvedContentIds: state.metadataById.size,\n        resumePositionsWithRuntime: metadataResolved,\n      },\n      importStrategy: { mode: strategy.mode, preview: strategy.preview },\n      remoteBefore: { libraryItems: state.remoteBefore.library.length, watchedItems: state.remoteBefore.watchedItems.length, watchProgressItems: state.remoteBefore.watchProgress.length },\n      remoteAfter: { libraryItems: libraryAfter.length, watchedItems: watchedAfter.length, watchProgressItems: progressAfter.length },\n    });\n    downloadJson(\`nuvio-trakt-import-audit-${'${new Date().toISOString().slice(0, 10)}'}.json\`, audit);\n    state.remoteBefore = { library: libraryAfter, watchedItems: watchedAfter, watchProgress: progressAfter };\n    $("success-panel").hidden = false;\n    $("success-summary").textContent = \`Strategy verified. Nuvio now has ${'${formatNumber(libraryAfter.length)}'} library items, ${'${formatNumber(watchedAfter.length)}'} watched states, and ${'${formatNumber(progressAfter.length)}'} Continue Watching entries.\`;\n    renderStrategyPreview();\n    setStatus("Import complete and verified. The audit report has been downloaded.", "success");\n  } catch (error) {\n    setStatus(\`Import stopped: ${'${error.message || error}'}\`, "error");\n  } finally {\n    setBusy(button, false);\n    updateImportReadiness();\n  }\n}\n`;
  output = replaceOnce(output, oldRunImport, newRunImport, "strategy import implementation");

  output = replaceOnce(
    output,
    '$("import-button").addEventListener("click", runImport);\n$("profile-select").addEventListener("change", () => {\n',
    '$("import-button").addEventListener("click", runImport);\n$("repair-artwork-button").addEventListener("click", repairArtwork);\ndocument.querySelectorAll(\'input[name="import-mode"]\').forEach((input) => input.addEventListener("change", () => { renderStrategyPreview(); updateDangerConfirmation(); }));\n$("danger-confirm-input").addEventListener("input", updateImportReadiness);\n$("profile-select").addEventListener("change", () => {\n',
    "strategy event listeners",
  );
  output = replaceOnce(
    output,
    '  $("backup-button").disabled = true;\n  $("remote-summary").hidden = true;\n  updateImportReadiness();\n});\n',
    '  $("backup-button").disabled = true;\n  $("remote-summary").hidden = true;\n  $("strategy-panel").hidden = true;\n  $("artwork-repair-panel").hidden = true;\n  $("repair-artwork-button").disabled = true;\n  $("danger-confirm-input").value = "";\n  updateImportReadiness();\n});\n',
    "reset strategy state when profile changes",
  );
  output = replaceOnce(
    output,
    '  state.token = null;\n  state.refreshToken = null;\n});\n',
    '  state.token = null;\n  state.refreshToken = null;\n  state.tmdbReadAccessToken = null;\n  if ($("tmdb-token")) $("tmdb-token").value = "";\n  if ($("repair-tmdb-token")) $("repair-tmdb-token").value = "";\n});\n',
    "clear TMDB tokens on unload",
  );
  return output;
}
