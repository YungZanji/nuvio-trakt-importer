import { patchAppSource as patchBaseAppSource } from "./patch-app-source.mjs";

function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Expected ${label} block was not found`);
  return source.replace(needle, replacement);
}

export function patchAppSource(source) {
  let patched = patchBaseAppSource(source);

  patched = replaceRequired(
    patched,
    'state.plan.progress = state.plan.progress.map((item) => applyRuntime(item, parseMetaRuntime(state.metadataById.get(metadataKey(item))));',
    'state.plan.progress = state.plan.progress.map((item) => applyRuntime(item, parseMetaRuntime(state.metadataById.get(metadataKey(item)))));',
    "transformed progress lookup",
  );

  patched = replaceRequired(
    patched,
    `async function pullProgress(profileId) {
  const items = await rpc("sync_pull_watch_progress", { p_profile_id: profileId });
  return Array.isArray(items) ? items : [];
}
`,
    `async function pullProgress(profileId, expectedCount = 0) {
  const requestedLimit = Math.max(10_000, Number(expectedCount || 0) + 500);
  const items = await rpc("sync_pull_watch_progress", {
    p_profile_id: profileId,
    p_limit: requestedLimit,
  });
  return Array.isArray(items) ? items : [];
}
`,
    "uncapped Continue Watching read",
  );

  patched = replaceRequired(
    patched,
    `function compareKeySets(actual, expected, keyFn) {
  const actualKeys = new Set(actual.map(keyFn));
  const expectedKeys = new Set(expected.map(keyFn));
  return {
    missing: [...expectedKeys].filter((key) => !actualKeys.has(key)),
    extra: [...actualKeys].filter((key) => !expectedKeys.has(key)),
  };
}

async function verifyStrategyResult(strategy, profileId) {
  const [libraryAfter, watchedAfter, progressAfter] = await Promise.all([pullLibrary(profileId), pullWatched(profileId), pullProgress(profileId)]);
  const checks = [
    ["library", compareKeySets(libraryAfter, strategy.library.target, libraryKey)],
    ["watched", compareKeySets(watchedAfter, strategy.watched.target, watchedKey)],
    ["progress", compareKeySets(progressAfter, strategy.progress.target, progressKey)],
  ];
  const failed = checks.filter(([, result]) => result.missing.length || result.extra.length);
  if (failed.length) {
    const detail = failed.map(([name, result]) => \`${'${name}'} missing=${'${result.missing.length}'} extra=${'${result.extra.length}'}\`).join(", ");
    throw new Error(\`Verification did not match the selected strategy: ${'${detail}'}. Your pre-change backup is still available.\`);
  }
  return { libraryAfter, watchedAfter, progressAfter };
}
`,
    `function compareKeySets(actual, expected, keyFn) {
  const actualKeys = new Set(actual.map(keyFn));
  const expectedKeys = new Set(expected.map(keyFn));
  return {
    missing: [...expectedKeys].filter((key) => !actualKeys.has(key)),
    extra: [...actualKeys].filter((key) => !expectedKeys.has(key)),
  };
}

function progressIdentity(item) {
  const contentId = String(item?.content_id || "").trim();
  const type = String(item?.content_type || "").toLowerCase();
  const season = item?.season == null ? null : Number(item.season);
  const episode = item?.episode == null ? null : Number(item.episode);
  if ((type === "series" || type === "tv") && Number.isFinite(season) && Number.isFinite(episode)) {
    return contentId + "|episode|" + season + "|" + episode;
  }
  return contentId + "|" + (type || "movie");
}

function newestByIdentity(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = progressIdentity(item);
    if (!key || key.startsWith("|")) continue;
    const existing = map.get(key);
    if (!existing || Number(item?.last_watched || 0) >= Number(existing?.last_watched || 0)) map.set(key, item);
  }
  return map;
}

function compareProgressSemantics(actual, expected, upserts, exactValues) {
  const actualByIdentity = newestByIdentity(actual);
  const expectedByIdentity = newestByIdentity(expected);
  const missing = [...expectedByIdentity.keys()].filter((key) => !actualByIdentity.has(key));
  const extra = [...actualByIdentity.keys()].filter((key) => !expectedByIdentity.has(key));
  const valueMismatches = [];
  for (const [key, expectedItem] of newestByIdentity(upserts)) {
    const actualItem = actualByIdentity.get(key);
    if (!actualItem) continue;
    const actualTime = Number(actualItem.last_watched || 0);
    const expectedTime = Number(expectedItem.last_watched || 0);
    const samePosition = Number(actualItem.position || 0) === Number(expectedItem.position || 0);
    const sameDuration = Number(actualItem.duration || 0) === Number(expectedItem.duration || 0);
    if (exactValues) {
      if (actualTime !== expectedTime || !samePosition || !sameDuration) valueMismatches.push(key);
    } else if (actualTime < expectedTime || (actualTime === expectedTime && (!samePosition || !sameDuration))) {
      valueMismatches.push(key);
    }
  }
  return { missing, extra, valueMismatches };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function progressRepairEntries(strategy, progressCheck) {
  const repairKeys = new Set([...progressCheck.missing, ...progressCheck.valueMismatches]);
  const targetByIdentity = newestByIdentity(strategy.progress.target);
  return [...repairKeys].map((key) => targetByIdentity.get(key)).filter(Boolean);
}

async function repairProgressEntries(entries, profileId) {
  const batches = chunk(sanitizeProgress(entries), 75);
  for (let index = 0; index < batches.length; index++) {
    setStatus("Safely retrying missing Continue Watching items: batch " + (index + 1) + "/" + batches.length + "…", "warning");
    await rpc("sync_push_watch_progress", {
      p_entries: batches[index],
      p_profile_id: profileId,
      p_origin_client_id: state.importerClientId,
    });
  }
}

async function verifyStrategyResult(strategy, profileId) {
  let lastResult = null;
  let progressRepairAttempted = false;
  const retryDelays = [0, 700, 1800, 3500, 6000];
  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (retryDelays[attempt]) await sleep(retryDelays[attempt]);
    const [libraryAfter, watchedAfter, progressAfter] = await Promise.all([
      pullLibrary(profileId),
      pullWatched(profileId),
      pullProgress(profileId, strategy.progress.target.length),
    ]);
    const libraryCheck = compareKeySets(libraryAfter, strategy.library.target, libraryKey);
    const watchedCheck = compareKeySets(watchedAfter, strategy.watched.target, watchedKey);
    const progressCheck = compareProgressSemantics(
      progressAfter,
      strategy.progress.target,
      strategy.progress.upserts,
      strategy.mode === IMPORT_MODES.MIRROR || strategy.mode === IMPORT_MODES.FRESH,
    );
    lastResult = { libraryAfter, watchedAfter, progressAfter, libraryCheck, watchedCheck, progressCheck };
    const failed = libraryCheck.missing.length || libraryCheck.extra.length ||
      watchedCheck.missing.length || watchedCheck.extra.length ||
      progressCheck.missing.length || progressCheck.extra.length || progressCheck.valueMismatches.length;
    if (!failed) return { libraryAfter, watchedAfter, progressAfter };

    const onlyRepairableProgressFailure =
      !libraryCheck.missing.length && !libraryCheck.extra.length &&
      !watchedCheck.missing.length && !watchedCheck.extra.length &&
      !progressCheck.extra.length &&
      (progressCheck.missing.length || progressCheck.valueMismatches.length);
    if (!progressRepairAttempted && attempt >= 1 && onlyRepairableProgressFailure) {
      const repairEntries = progressRepairEntries(strategy, progressCheck);
      if (repairEntries.length) {
        setStatus(
          "Nuvio Sync did not return " + repairEntries.length + " Continue Watching item(s) after the first checks. Retrying only those items without clearing anything…",
          "warning",
        );
        await repairProgressEntries(repairEntries, profileId);
        progressRepairAttempted = true;
      }
    }
  }

  const { libraryCheck, watchedCheck, progressCheck } = lastResult;
  const details = [];
  if (libraryCheck.missing.length || libraryCheck.extra.length) details.push("library missing=" + libraryCheck.missing.length + " extra=" + libraryCheck.extra.length);
  if (watchedCheck.missing.length || watchedCheck.extra.length) details.push("watched missing=" + watchedCheck.missing.length + " extra=" + watchedCheck.extra.length);
  if (progressCheck.missing.length || progressCheck.extra.length || progressCheck.valueMismatches.length) {
    details.push("progress missing=" + progressCheck.missing.length + " extra=" + progressCheck.extra.length + " value-mismatch=" + progressCheck.valueMismatches.length);
  }
  const sample = progressCheck.missing.slice(0, 3);
  const sampleText = sample.length ? " Missing progress examples: " + sample.join(", ") + "." : "";
  const repairText = progressRepairAttempted
    ? " The importer safely retried only the missing Continue Watching items, but Nuvio Sync still did not return them."
    : "";
  throw new Error("Verification did not match the selected strategy after extended read-back checks: " + details.join(", ") + "." + sampleText + repairText + " Your pre-change backup is still available.");
}
`,
    "semantic progress verification and recovery",
  );

  patched = replaceRequired(
    patched,
    `      await rpc("sync_push_library", { p_items: sanitizeLibrary(strategy.library.target), p_profile_id: profileId, p_origin_client_id: state.importerClientId });
      if (strategy.watched.deletes.length) {
`,
    `      await rpc("sync_push_library", { p_items: sanitizeLibrary(strategy.library.target), p_profile_id: profileId, p_origin_client_id: state.importerClientId });
      if (strategy.mode === IMPORT_MODES.MIRROR) {
        setStatus("Verifying Library mirror before any watched/progress removals…");
        const libraryCheck = await pullLibrary(profileId);
        const mirrorLibraryCheck = compareKeySets(libraryCheck, strategy.library.target, libraryKey);
        if (mirrorLibraryCheck.missing.length || mirrorLibraryCheck.extra.length) {
          throw new Error("Nuvio did not produce the requested Library mirror (missing " + mirrorLibraryCheck.missing.length + ", extra " + mirrorLibraryCheck.extra.length + "). Watched and Continue Watching removals were not started.");
        }
      }
      if (strategy.watched.deletes.length) {
`,
    "mirror library safety gate",
  );

  return patched;
}
