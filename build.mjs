import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { patchAppSource } from "./src/app-transform.mjs";
import { patchExportUiSource } from "./src/export-ui-transform.mjs";
import { patchExportTemplate } from "./src/export-template.mjs";

const root = resolve(import.meta.dirname);
const buildDir = resolve(root, ".build");
const outJs = resolve(buildDir, "app.js");

await mkdir(buildDir, { recursive: true });
const originalApp = await readFile(resolve(root, "src/app.mjs"), "utf8");
const patchedApp = patchExportUiSource(patchAppSource(originalApp));

await build({
  stdin: {
    contents: patchedApp,
    resolveDir: resolve(root, "src"),
    sourcefile: "app.mjs",
    loader: "js",
  },
  outfile: outJs,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome110", "firefox115", "edge110"],
  legalComments: "none",
});

const [template, css, exportCss, js, packageText, font] = await Promise.all([
  readFile(resolve(root, "src/index.template.html"), "utf8"),
  readFile(resolve(root, "src/styles.css"), "utf8"),
  readFile(resolve(root, "src/export-ui.css"), "utf8"),
  readFile(outJs, "utf8"),
  readFile(resolve(root, "package.json"), "utf8"),
  readFile(resolve(root, "src/assets/google-sans-flex-latin.woff2")),
]);

const fontData = `data:font/woff2;base64,${font.toString("base64")}`;
const bundledCss = `${css}\n${exportCss}`.replace("__GOOGLE_SANS_FLEX_DATA__", () => fontData);
const sha256 = (value) => createHash("sha256").update(value).digest("base64");
const csp = [
  "default-src 'none'",
  `script-src 'sha256-${sha256(js)}'`,
  `style-src 'sha256-${sha256(bundledCss)}'`,
  "font-src data:",
  "connect-src https://api.nuvio.tv https://api-two.nuvioapp.space https://api.themoviedb.org https://v3-cinemeta.strem.io",
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
].join("; ");
const patchedTemplate = patchExportTemplate(template);
const html = patchedTemplate
  .replace("/* APP_CSP */", () => csp)
  .replace("/* APP_CSS */", () => bundledCss)
  .replace("/* APP_JS */", () => js);
const version = JSON.parse(packageText).version;
const siteDir = resolve(root, "_site");
await mkdir(siteDir, { recursive: true });
await Promise.all([
  writeFile(resolve(root, "Nuvio-Trakt-Importer.html"), html),
  writeFile(resolve(root, `Nuvio-Trakt-Importer-v${version}.html`), html),
  writeFile(resolve(root, "index.html"), html),
  writeFile(resolve(siteDir, "index.html"), html),
  writeFile(resolve(siteDir, ".nojekyll"), ""),
]);
