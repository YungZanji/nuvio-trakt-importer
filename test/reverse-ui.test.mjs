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
  assert.match(source, /function exportCollectExactChanges\(result\)/);
  assert.match(source, /renderExportExactChanges\(exportMergeResult\)/);
  assert.match(source, /Cleared after newer finished state/);
});
