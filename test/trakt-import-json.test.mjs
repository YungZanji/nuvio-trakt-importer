import test from "node:test";
import assert from "node:assert/strict";
import { buildTraktImportJson } from "../src/trakt-import-json.mjs";

const imdbMovie = { title:"Example Movie", ids:{ imdb:"tt1111111", trakt:11, tmdb:111 } };
const show = { title:"Black Clover", ids:{ imdb:"tt7441658", tmdb:73223, trakt:789 } };
const oldEpisode = { season:1, number:1, title:"Asta and Yuno", ids:{ trakt:987654, tmdb:612312 } };

function archive() {
  return new Map([
    ["watched-history-1.json", JSON.stringify([
      { type:"movie", movie:imdbMovie, watched_at:"2025-01-01T00:00:00Z" },
      { type:"episode", show, episode:oldEpisode, watched_at:"2025-01-02T00:00:00Z" },
    ])],
    ["lists-watchlist.json", JSON.stringify([
      { type:"movie", movie:imdbMovie, listed_at:"2024-11-01T00:00:00Z" },
    ])],
  ]);
}

function merger(archiveMap) {
  const history = [
    {id:"watched:0", entry:{ type:"episode", show, episode:{season:1,number:1}, watched_at:"2026-01-01T00:00:00Z" }},
    {id:"watched:1", entry:{ type:"episode", show, episode:{season:1,number:2}, watched_at:"2026-01-02T00:00:00Z" }},
    {id:"watched:2", entry:{ type:"movie", movie:imdbMovie, watched_at:"2026-01-03T00:00:00Z" }},
  ];
  const watchlist = [{id:"library:0", entry:{type:"show",show,listed_at:"2026-01-01T00:00:00Z"}}];
  return { changes:{history, watchlist,playback:[]}, updates:new Map([
    ["watched-history-1.json", JSON.stringify([...JSON.parse(archiveMap.get("watched-history-1.json")), ...history.map(x=>x.entry)])],
    ["lists-watchlist.json", JSON.stringify([...JSON.parse(archiveMap.get("lists-watchlist.json")),watchlist[0].entry])],
  ]) };
}

test("Trakt file importer gets a flat JSON array with episode-level identifiers", () => {
  const files=archive(), merge=merger(files);
  const result=buildTraktImportJson(files,merge,{ episodeIds:new Map([["imdb:tt7441658|s1e2",{tmdb:944321}]]) });
  assert.equal(result.summary.unresolved,0);
  assert.equal(result.summary.history,3);
  assert.equal(result.summary.episodes,2);
  assert.equal(result.summary.watchlist,1);
  const first=result.rows.find(x=>x.type==="episode"&&x.watched_at.startsWith("2026-01-01"));
  const second=result.rows.find(x=>x.type==="episode"&&x.watched_at.startsWith("2026-01-02"));
  assert.deepEqual(first,{trakt_id:"987654",type:"episode",watched_at:"2026-01-01T00:00:00.000Z"});
  assert.deepEqual(second,{tmdb_id:"944321",type:"episode",watched_at:"2026-01-02T00:00:00.000Z"});
  assert.equal(result.rows.some(x=>x.type==="episode"&&x.imdb_id==="tt7441658"),false);
  assert.ok(result.rows.some(x=>x.type==="show"&&x.imdb_id==="tt7441658"&&x.watchlisted_at));
  for(const row of result.rows) {
    assert.equal(Object.prototype.hasOwnProperty.call(row,"show"),false);
    assert.equal(Object.prototype.hasOwnProperty.call(row,"episode"),false);
    assert.equal(Object.prototype.hasOwnProperty.call(row,"progress"),false);
    assert.equal(Object.prototype.hasOwnProperty.call(row,"action"),false);
  }
});

test("new-only requires episode ID; never marks entire show watched",()=>{
  const files=archive(), result=buildTraktImportJson(files,merger(files));
  assert.equal(result.summary.unresolved,1);
  assert.equal(result.unresolved[0].reason,"Episode-specific ID required");
  assert.equal(result.unresolved[0].changeId,"watched:1");
  assert.equal(result.rows.some(x=>x.type==="episode"&&x.imdb_id==="tt7441658"),false);
});

test("exclusions apply to website JSON as well as ZIP",()=>{
  const files=archive(), merge=merger(files);
  const result=buildTraktImportJson(files,merge,{excluded:new Set(["watched:1","library:0"])});
  assert.equal(result.summary.unresolved,0);
  assert.equal(result.summary.history,2);
  assert.equal(result.summary.watchlist,0);
});

test("full import mode retains original watch events as well as selected new history",()=>{
  const files=archive(), merge=merger(files);
  const result=buildTraktImportJson(files,merge,{scope:"all",episodeIds:new Map([["imdb:tt7441658|s1e2",{tmdb:944321}]])});
  assert.equal(result.summary.unresolved,0);
  assert.equal(result.summary.history,5);
  assert.equal(result.summary.watchlist,2);
});

test("invalid or absent episode IDs are explicitly unresolved",()=>{
  const files=archive(), merge=merger(files);
  const result=buildTraktImportJson(files,merge,{episodeIds:new Map([["imdb:tt7441658|s1e2",{imdb:"tt7441658:1:2"}]])});
  assert.equal(result.summary.unresolved,1);
});

test("file generator rejects malformed relevant history, instead of silently dropping records",()=>{
  const files=archive();files.set("watched-history-1.json","{");
  assert.throws(()=>buildTraktImportJson(files,merger(archive()),{scope:"all"}),/Cannot parse/);
});


test("rejects movie records whose IMDb ID also identifies a TV show",()=>{
  const files=archive();
  const ambiguous={type:"movie",movie:{title:"VisionQuest",ids:{imdb:"tt23112594"}},watched_at:"2026-02-01T00:00:00Z"};
  const tv={type:"episode",show:{title:"VisionQuest",ids:{imdb:"tt23112594"}},episode:{season:1,number:1},watched_at:"2026-02-02T00:00:00Z"};
  const merge={
    changes:{history:[{id:"watched:0",entry:ambiguous},{id:"watched:1",entry:tv}],watchlist:[],playback:[]},
    updates:new Map([["watched-history-1.json",JSON.stringify([...JSON.parse(files.get("watched-history-1.json")),ambiguous,tv])]]),
  };
  const result=buildTraktImportJson(files,merge);
  assert.ok(result.unresolved.some(item=>item.reason==="Movie/show identifier conflict"&&item.changeId==="watched:0"));
  assert.equal(result.rows.filter(item=>item.type==="movie").length,0);
});
