import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const template = await readFile(new URL("../src/index.template.html", import.meta.url), "utf8");

test("source does not use persistent browser storage or tracking APIs", () => {
  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "document.cookie",
    "sendBeacon",
    "WebSocket",
    "EventSource",
  ]) {
    assert.equal(app.includes(forbidden), false, `unexpected browser API: ${forbidden}`);
  }
});

test("network origins are explicit and privacy UI is present", () => {
  assert.match(app, /https:\/\/api\.nuvio\.tv/);
  assert.match(app, /https:\/\/api-two\.nuvioapp\.space/);
  assert.match(app, /https:\/\/v3-cinemeta\.strem\.io/);
  assert.match(template, /Your ZIP stays in this browser/);
  assert.match(template, /name="referrer" content="no-referrer"/);
});

test("Google Sans Flex is embedded by the build instead of loaded from Google", () => {
  assert.match(styles, /font-family: "Google Sans Flex"/);
  assert.match(styles, /__GOOGLE_SANS_FLEX_DATA__/);
  assert.equal(styles.includes("fonts.googleapis.com"), false);
  assert.equal(styles.includes("fonts.gstatic.com"), false);
});
