import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];

assert.ok(style, "bundled stylesheet not found");
assert.ok(script, "bundled script not found");
assert.ok(csp, "Content Security Policy not found");
assert.equal(html.includes("/* APP_"), false, "build placeholders remain");
assert.match(style, /data:font\/woff2;base64,/);
assert.equal(html.includes("fonts.googleapis.com"), false);
assert.equal(html.includes("fonts.gstatic.com"), false);

const digest = (value) => createHash("sha256").update(value).digest("base64");
assert.ok(csp.includes(`script-src 'sha256-${digest(script)}'`), "script CSP hash mismatch");
assert.ok(csp.includes(`style-src 'sha256-${digest(style)}'`), "style CSP hash mismatch");
assert.ok(csp.includes("connect-src https://api.nuvio.tv https://api-two.nuvioapp.space https://v3-cinemeta.strem.io"));

console.log("Privacy-hardened bundle verification passed");
