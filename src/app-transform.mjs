import { patchAppSource as patchBaseAppSource } from "./patch-app-source.mjs";

export function patchAppSource(source) {
  const patched = patchBaseAppSource(source);
  const broken = 'state.plan.progress = state.plan.progress.map((item) => applyRuntime(item, parseMetaRuntime(state.metadataById.get(metadataKey(item))));';
  const fixed = 'state.plan.progress = state.plan.progress.map((item) => applyRuntime(item, parseMetaRuntime(state.metadataById.get(metadataKey(item)))));';
  if (!patched.includes(broken)) throw new Error("Expected transformed progress lookup was not found");
  return patched.replace(broken, fixed);
}
