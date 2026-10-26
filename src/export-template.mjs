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
      <p class="reverse-workflow-note"><strong>Reverse workflow:</strong> only the four steps below belong to Nuvio → Trakt. The original Trakt ZIP is used only as the historical base that Nuvio's newer state is merged into.</p>

      <section>
        <div class="step-number">1</div>
        <div class="step-content">
          <h2>Choose the original Trakt archive to update</h2>
          <p>This is not the Trakt → Nuvio import step. The reverse exporter needs your original Trakt ZIP only as a historical baseline. Ratings, custom lists, social records, and other unrelated Trakt files are carried through untouched.</p>
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
          <p>This button starts Nuvio's TV sign-in directly from the reverse workflow. No Trakt import plan, TMDB lookup, or other Trakt → Nuvio setup is required first.</p>
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
          <h2>Review exact changes and export</h2>
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

          <div class="export-metadata-tool">
            <h3>Resolve missing titles and episode names</h3>
            <p>IMDb IDs such as <code>tt1234567</code> identify titles, not episode names. Check the Trakt archive first; for anything missing, you can resolve only public IDs and season/episode numbers with TMDB or Cinemeta. No watch timestamps, account information or ZIP contents are sent to metadata services.</p>
            <label for="export-metadata-token">TMDB API Read Access Token (optional, recommended)</label>
            <input id="export-metadata-token" type="password" autocomplete="off" spellcheck="false" placeholder="TMDB v3 Read Access Token; used once and cleared">
            <p><a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer">Get your TMDB read token</a>. Without a token, Cinemeta is tried for IMDb IDs. You must choose to start the lookup.</p>
            <button id="export-resolve-button" type="button" class="secondary" disabled>Resolve unidentified titles</button>
            <p id="export-meta-state" class="substatus" aria-live="polite"></p>
          </div>

          <div id="export-preview" hidden>
            <div class="export-select-controls">
              <p><strong>Choose which new changes to include.</strong> Uncheck any addition or update you don't want in the merged ZIP. Your original Trakt data is never deleted by these exclusions.</p>
              <div class="button-row">
                <button id="export-select-all" type="button" class="secondary">Include all changes</button>
                <button id="export-select-none" type="button" class="secondary">Exclude all changes</button>
              </div>
              <p id="export-selection-status" class="substatus" aria-live="polite"></p>
            </div>
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

            <details id="export-change-details" class="export-change-details" open>
              <summary>Show the exact Nuvio → Trakt changes</summary>
              <p class="export-change-intro">These are proposed edits to the Trakt ZIP. Uncheck any item to leave it out of the download; the totals above update automatically. Unknown titles stay marked with their IMDb/TMDB ID until resolved.</p>
              <div class="export-change-groups">
                <div class="export-change-group">
                  <h3>Watchlist additions <span id="export-detail-watchlist-count">0</span></h3>
                  <ul id="export-detail-watchlist" class="export-change-list"></ul>
                </div>
                <div class="export-change-group">
                  <h3>New watched-history entries <span id="export-detail-history-count">0</span></h3>
                  <ul id="export-detail-history" class="export-change-list"></ul>
                </div>
                <div class="export-change-group">
                  <h3>Continue Watching changes <span id="export-detail-playback-count">0</span></h3>
                  <ul id="export-detail-playback" class="export-change-list"></ul>
                </div>
              </div>
            </details>

            <p id="export-warnings" class="inline-warning" hidden></p>
          </div>

          <div class="export-format-chooser" role="group" aria-labelledby="export-output-heading">
            <h3 id="export-output-heading">Choose final file format</h3>
            <label class="export-format-card">
              <input type="radio" name="reverse-file-format" value="archive" checked>
              <span><strong>Trakt backup archive (.zip)</strong><small>Preserve the original full Trakt export plus only the Nuvio changes you approved. This is a backup, not a direct Trakt website import file.</small></span>
            </label>
            <label class="export-format-card">
              <input type="radio" name="reverse-file-format" value="import">
              <span><strong>Trakt website import (.json)</strong><small>Generate the flat JSON array accepted by Trakt → Settings → Data → Import → JSON File.</small></span>
            </label>
            <div id="export-import-options" hidden>
              <label class="export-format-card export-scope">
                <input id="export-import-full" type="checkbox">
                <span><strong>Include all original Trakt history too</strong><small>Off by default: only the selected *new* Nuvio watches and watchlist additions are imported, avoiding re-importing thousands of historical plays.</small></span>
              </label>
              <div class="export-episode-tool">
                <p><strong>Episode-specific IDs are required.</strong> Trakt cannot match a watched episode reliably from the parent show's IMDb ID alone. The tool reuses episode IDs in your old Trakt archive; for new episodes, supply your TMDB token above and choose Resolve missing episode IDs. No watch history or login information is sent to TMDB.</p>
                <button id="export-resolve-episodes" type="button" class="secondary" disabled>Resolve missing episode IDs</button>
                <button id="export-skip-unmatched" type="button" class="secondary" hidden>Exclude unresolved new entries</button>
                <p id="export-episode-status" class="substatus" aria-live="polite"></p>
                <details id="export-import-unmatched" hidden>
                  <summary>Review unmatched import entries</summary>
                  <p class="substatus">These records will not be silently skipped or converted into whole-show watches. Resolve valid episode IDs or exclude the individual entries in the preview.</p>
                  <ul id="export-import-unmatched-list" class="export-unmatched-list"></ul>
                </details>
                <p class="inline-warning">Trakt's JSON import format supports watch history and watchlist dates, but does not support Continue Watching percentages. Use the ZIP format to preserve resume positions.</p>
              </div>
            </div>
          </div>

          <section class="trakt-direct-sync" id="trakt-direct-sync" aria-labelledby="trakt-direct-title">
            <h3 id="trakt-direct-title">Or sync selected Nuvio changes directly to Trakt</h3>
            <p>Send only the selected new watched events and watchlist additions, plus unfinished playback positions, to your Trakt account. Nothing is written until you review the live comparison and confirm.</p>
            <p class="substatus">Create a Trakt developer application once, then register the callback URL <code>https://yungzanji.github.io/nuvio-trakt-importer/</code> and CORS origin <code>https://yungzanji.github.io</code>. Use only its <strong>Client ID</strong>; never provide a Client Secret.</p>
            <label for="trakt-client-id">Your Trakt application Client ID</label>
            <input id="trakt-client-id" type="text" spellcheck="false" autocomplete="off" placeholder="Paste Trakt Client ID">
            <p><a href="https://app.trakt.tv/oauth/applications" target="_blank" rel="noopener noreferrer">Create or view a Trakt application</a>. This is a one-time connection for this browser tab. Your token is not stored in browser storage or uploaded to us.</p>
            <div class="trakt-direct-actions">
              <button id="trakt-authorize" class="secondary" type="button">Authorize Trakt (PKCE)</button>
              <button id="trakt-resolve-ids" class="secondary" type="button" disabled>Resolve missing episode IDs</button>
              <button id="trakt-check" class="secondary" type="button" disabled>Compare with live Trakt account</button>
              <button id="trakt-commit" type="button" disabled>Confirm and sync to Trakt</button>
              <button id="trakt-disconnect" class="secondary" type="button" disabled>Disconnect</button>
            </div>
            <p id="trakt-connect-status" class="substatus" aria-live="polite">Not connected to Trakt.</p>
            <div id="trakt-live-plan" hidden>
              <h4>Live Trakt comparison</h4>
              <p id="trakt-plan-counts" aria-live="polite"></p>
              <p class="inline-warning">Trakt's pause API saves the current resume percentage, but it cannot backdate the original Nuvio pause time. Paused progress may not appear in Trakt's Next Up list. This sync does not delete existing Trakt data.</p>
            </div>
          </section>

          <button id="export-button" type="button" class="import-button" disabled>Download merged Trakt archive (.zip)</button>
          <p class="substatus">Only selected additions and updates are written to the ZIP. Unselected changes stay out; source Trakt history stays intact.</p>
          <p class="substatus">No Trakt API key or Trakt login is required. The files are generated entirely in your browser. A TMDB token is needed only for episode-ID lookups that cannot be resolved from the old Trakt archive.</p>
        </div>
      </section>
    </div>

    <footer>
`,
    "reverse exporter workflow",
  );

  return html;
}
