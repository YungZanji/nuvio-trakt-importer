function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Expected ${label} block was not found`);
  return source.replace(needle, replacement);
}

export function patchExportTemplate(source) {
  let html = source;

  html = replaceRequired(
    html,
    '<meta name="description" content="Privately import a Trakt export into Nuvio Sync. Your ZIP is processed entirely in your browser.">',
    '<meta name="description" content="Privately move watch history between Trakt exports and Nuvio Sync. Your archive is processed entirely in your browser.">',
    "page description",
  );

  html = replaceRequired(
    html,
    '<title>Trakt to Nuvio Sync Importer</title>',
    '<title>Trakt ↔ Nuvio Sync Migration Tool</title>',
    "page title",
  );

  html = replaceRequired(
    html,
    '    </header>\n\n    <div id="status" class="status" hidden aria-live="polite"></div>',
    `    </header>

    <div class="tool-tabs" role="tablist" aria-label="Migration direction">
      <button id="tool-import-tab" class="tool-tab active" type="button" role="tab" aria-selected="true">Trakt → Nuvio</button>
      <button id="tool-export-tab" class="tool-tab" type="button" role="tab" aria-selected="false">Nuvio → Trakt</button>
    </div>

    <div id="status" class="status" hidden aria-live="polite"></div>`,
    "migration direction tabs",
  );

  html = replaceRequired(
    html,
    '    <footer>\n',
    `    <div id="exporter-workflow" hidden>
      <section>
        <div class="step-number">1</div>
        <div class="step-content">
          <h2>Choose your original Trakt export</h2>
          <p>This archive is the historical base. The exporter keeps ratings, custom lists, social records, and other Trakt-specific files untouched, then updates only watch-history-related data from Nuvio.</p>
          <label class="file-picker">
            <input id="export-zip-input" type="file" accept=".zip,application/zip">
            <span>Choose original Trakt ZIP</span>
          </label>
          <p id="export-source-summary" class="substatus" hidden></p>
        </div>
      </section>

      <section>
        <div class="step-number">2</div>
        <div class="step-content">
          <h2>Sign in to Nuvio Sync</h2>
          <p>The exporter reads your current Nuvio tracking data using the same private TV sign-in flow as the importer. It does not write anything back to Nuvio.</p>
          <button id="export-login-button" type="button">Start Nuvio sign-in</button>
          <div id="export-login-slot"></div>
        </div>
      </section>

      <section>
        <div class="step-number">3</div>
        <div class="step-content">
          <h2>Read the Nuvio profile</h2>
          <p>Select the profile whose Library, watched states, and Continue Watching positions should be merged into the Trakt archive.</p>
          <div id="export-profile-slot"></div>
          <div id="export-remote-slot"></div>
        </div>
      </section>

      <section>
        <div class="step-number">4</div>
        <div class="step-content">
          <h2>Review and export</h2>
          <p>Nuvio is allowed to supersede older Trakt state only when its timestamp is newer. Existing Trakt history is retained instead of being flattened or deleted.</p>

          <div class="export-rule-box">
            <strong>Merge rules</strong>
            <ul>
              <li>Every Nuvio Library item is mapped to the Trakt watchlist, for both movies and shows.</li>
              <li>A newer Nuvio watched timestamp is added to Trakt history; an older Nuvio timestamp never replaces newer Trakt history.</li>
              <li>Continue Watching uses the newest pause timestamp and converts Nuvio milliseconds back to a Trakt playback percentage.</li>
              <li>If an item was later finished, stale playback from before that watched timestamp is removed.</li>
              <li>Ratings, custom lists, and other unrelated Trakt export files are preserved unchanged.</li>
            </ul>
          </div>

          <p class="inline-warning">Nuvio Sync exposes the current watched state and latest timestamp, not a complete replay-event log. If the same movie or episode was rewatched multiple times after your Trakt export, the exporter can preserve the newest known state but cannot reconstruct every missing replay event.</p>

          <div id="export-preview" hidden>
            <div class="stat-grid">
              <div><strong id="export-count-watchlist">0</strong><span>Watchlist additions</span></div>
              <div><strong id="export-count-watched">0</strong><span>Newer watched states</span></div>
              <div><strong id="export-count-progress">0</strong><span>Playback add/updates</span></div>
              <div><strong id="export-count-finished">0</strong><span>Stale playback cleared</span></div>
            </div>
            <div class="export-final-grid">
              <div><strong id="export-final-history">0</strong><span>History plays in merged archive</span></div>
              <div><strong id="export-final-watchlist">0</strong><span>Watchlist items in merged archive</span></div>
              <div><strong id="export-final-progress">0</strong><span>Playback positions in merged archive</span></div>
            </div>
            <p id="export-warnings" class="inline-warning" hidden></p>
          </div>

          <button id="export-button" type="button" class="import-button" disabled>Download merged Trakt archive</button>
          <p class="substatus">No Trakt API key or Trakt login is required. The tool creates a merged Trakt-style ZIP locally in your browser and never uploads the source archive.</p>
        </div>
      </section>
    </div>

    <footer>
`,
    "reverse exporter workflow",
  );

  return html;
}
