import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { patchAppSource } from "../src/app-transform.mjs";
import { patchExportUiSource } from "../src/export-ui-transform.mjs";
import { patchExportTemplate } from "../src/export-template.mjs";

const root = resolve(import.meta.dirname, "..");

async function transformedAppSource() {
  const source = await readFile(resolve(root, "src/app.mjs"), "utf8");
  return patchExportUiSource(patchAppSource(source));
}

test("reverse tab hides the forward workflow with both hidden and explicit display state", async () => {
  const source = await transformedAppSource();
  assert.match(source, /section\.hidden = exporting/);
  assert.match(source, /section\.style\.display = exporting \? "none" : ""/);
  assert.match(source, /exporterWorkflow\.style\.display = exporting \? "" : "none"/);

  const css = await readFile(resolve(root, "src/export-ui.css"), "utf8");
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test("reverse Nuvio sign-in does not depend on a Trakt import plan", async () => {
  const source = await transformedAppSource();
  const start = source.indexOf("async function startLogin()");
  assert.notEqual(start, -1);
  const loginBlock = source.slice(start, source.indexOf("function scheduleLoginPoll", start));
  assert.doesNotMatch(loginBlock, /if \(!state\.plan\) return/);
  assert.match(loginBlock, /activeTool === "export" \? \$\("export-login-button"\) : \$\("login-button"\)/);
  assert.match(source, /\$\("export-login-button"\)\?\.addEventListener\("click", startLogin\)/);
});

test("reverse workflow has four isolated steps and exact before-after change lists", async () => {
  const templateSource = await readFile(resolve(root, "src/index.template.html"), "utf8");
  const html = patchExportTemplate(templateSource);
  const reverseStart = html.indexOf('<div id="exporter-workflow"');
  const reverseEnd = html.indexOf("<footer>", reverseStart);
  assert.notEqual(reverseStart, -1);
  assert.notEqual(reverseEnd, -1);
  const reverse = html.slice(reverseStart, reverseEnd);
  assert.equal((reverse.match(/class="step-number"/g) || []).length, 4);
  assert.match(reverse, /No Trakt import plan, TMDB lookup, or other Trakt → Nuvio setup is required first/);
  assert.match(reverse, /id="export-detail-watchlist"/);
  assert.match(reverse, /id="export-detail-history"/);
  assert.match(reverse, /id="export-detail-playback"/);

  const source = await transformedAppSource();
  assert.match(source, /function exportPopulateChangeList/);
  assert.match(source, /renderExportExactChanges\(exportCandidates\)/);
  assert.match(source, /exportExcludedChanges/);
  assert.match(source, /exportResolveTitles/);
  assert.match(source, /excluded: exportExcludedChanges/);
  assert.match(reverse, /id="export-resolve-button"/);
  assert.match(reverse, /id="export-select-all"/);
  assert.match(reverse, /id="export-select-none"/);
});


test("reverse workflow offers archive ZIP and exact Trakt web-import JSON formats", async () => {
  const html = patchExportTemplate(await readFile(resolve(root, "src/index.template.html"), "utf8"));
  assert.match(html, /name="reverse-file-format" value="archive"/);
  assert.match(html, /name="reverse-file-format" value="import"/);
  assert.match(html, /id="export-import-full"/);
  assert.match(html, /id="export-resolve-episodes"/);
  assert.match(html, /id="export-import-unmatched-list"/);

  const source = await transformedAppSource();
  assert.match(source, /function downloadTraktWebImport/);
  assert.match(source, /function renderTraktImportReadiness/);
  assert.match(source, /resolveTmdbSeasonEpisodeIds/);
  assert.match(source, /validated|result\.unresolved\.length/);
  assert.match(source, /"application\/json"/);
  assert.match(source, /excluded: exportExcludedChanges/);
});


test("direct sync has independent Trakt authorization, live review and explicit write confirmation",async()=>{
  const html=patchExportTemplate(await readFile(resolve(root,"src/index.template.html"),"utf8"));
  for(const id of ["trakt-client-id","trakt-authorize","trakt-resolve-ids","trakt-check","trakt-commit","trakt-disconnect","trakt-live-plan"]){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  const source=await transformedAppSource();
  assert.match(source,/createTraktAuthorization/);
  assert.match(source,/exchangeTraktCode/);
  assert.match(source,/planTraktSync/);
  assert.match(source,/executeTraktSync/);
  assert.match(source,/window\.confirm\(/);
  assert.match(source,/traktLivePlan=null/);
  assert.match(source,/window\.opener\.postMessage/);
  const csp=await readFile(resolve(root,"build.mjs"),"utf8");
  assert.match(csp,/https:\/\/auth\.trakt\.tv/);
  assert.match(csp,/https:\/\/api\.trakt\.tv/);
});


test("direct resolver includes Continue Watching episodes without switching to JSON mode", async()=>{
  const html=patchExportTemplate(await readFile(resolve(root,"src/index.template.html"),"utf8"));
  assert.match(html,/id="trakt-resolve-ids"/);
  assert.match(html,/id="trakt-skip-unmatched-playback"/);
  const source=await transformedAppSource();
  assert.match(source,/const syncMissing = syncCandidatesNow\(\)\.unresolved/);
  assert.match(source,/row.reason\?\.startsWith\("Episode-specific ID required"\)/);
  assert.match(source,/\$\("trakt-resolve-ids"\)\?\.addEventListener\("click", resolveMissingTraktEpisodes\)/);
  assert.match(source,/excludeUnmatchedTraktPlayback/);
  assert.match(source,/error\.code = "MISSING_IDS"/);
  assert.doesNotMatch(source,/Resolve missing episode IDs \(in JSON mode\)/);
  assert.doesNotMatch(source,/Ensure your app's CORS origin is set correctly/);
});


test("changing reviewed selections invalidates previous direct-sync plan and enforces allowlist", async()=>{
  const source=await transformedAppSource();
  const start=source.indexOf("function renderExportPreview()");
  const preview=source.slice(start,source.indexOf("function selectedTraktFormat()",start));
  assert.match(preview,/traktPreviewRevision\+\+/);
  assert.match(preview,/traktLivePlan = null/);
  assert.match(preview,/updateTraktSyncUi\(\)/);
  const select=source.slice(source.indexOf("function syncCandidatesNow()"),source.indexOf("function excludeUnmatchedTraktPlayback()"));
  assert.match(select,/selectedChangeIds:approvedIds/);
  assert.match(select,/exportCandidates/);
  assert.match(select,/filter\(row=>!exportExcludedChanges\.has\(row\.id\)\)/);
  const commit=source.slice(source.indexOf("async function commitTraktDirect()"),source.indexOf("function updateExportReadiness()"));
  assert.match(commit,/revision!==traktPreviewRevision/);
  assert.match(commit,/onConfirmed:/);
  assert.match(source,/unsupportedPlayback\.length/);
  const html=patchExportTemplate(await readFile(resolve(root,"src/index.template.html"),"utf8"));
  assert.match(html,/id="trakt-unsupported-list"/);
});
