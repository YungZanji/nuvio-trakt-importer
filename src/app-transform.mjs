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
