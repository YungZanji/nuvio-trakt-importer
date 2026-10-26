import test from "node:test";
import assert from "node:assert/strict";
import { buildTraktSyncCandidates, planTraktSync, executeTraktSync,
  createTraktAuthorization, exchangeTraktCode, makeTraktApi } from "../src/trakt-direct-sync.mjs";

const movie={title:"Film",ids:{imdb:"tt1234567",tmdb:88}};
const show={title:"Black Clover",ids:{imdb:"tt7441658",tmdb:73223}};
const oldFiles=new Map([
  ["watched-history-1.json",JSON.stringify([{type:"movie",movie,watched_at:"2025-01-01T00:00:00Z"}])],
  ["lists-watchlist.json",JSON.stringify([])],
]);
const merged={updates:new Map(),changes:{
  history:[{id:"watched:0",entry:{type:"episode",show,episode:{season:1,number:11},
    watched_at:"2026-10-25T19:33:00Z"}}],
  watchlist:[{id:"library:0",entry:{type:"show",show,listed_at:"2026-10-01T00:00:00Z"}}],
  playback:[{id:"progress:0",action:"update",
    entry:{type:"episode",show,episode:{season:1,number:12},
      progress:62.5,paused_at:"2026-10-26T01:00:00Z"}}],
}};
const ids=new Map([
  ["imdb:tt7441658|s1e11",{tmdb:90011}],
  ["imdb:tt7441658|s1e12",{tmdb:90012}],
]);
const wrap=(body)=>({body,response:{headers:{get:()=>null}}});

test("OAuth authorization uses PKCE S256 without any client secret",async()=>{
  const data=await createTraktAuthorization({clientId:"abcdefghijklmn123456",redirectUri:"https://example.github.io/tool/"});
  const url=new URL(data.url);
  assert.equal(url.host,"auth.trakt.tv");
  assert.equal(url.searchParams.get("code_challenge_method"),"S256");
  assert.equal(url.searchParams.get("client_secret"),null);
  assert.equal(url.searchParams.get("client_id"),"abcdefghijklmn123456");
  assert.equal(data.verifier.length>=43,true);
  assert.equal(url.searchParams.get("state"),data.state);
});

test("Trakt OAuth token exchange sends verifier but not client_secret",async()=>{
  let payload;
  const {accessToken}=await exchangeTraktCode({code:"code",verifier:"verifier",
    clientId:"client",redirectUri:"https://site.example/test/",fetchImpl:async(url,request)=>{
      assert.equal(url,"https://auth.trakt.tv/oauth/token");
      payload=JSON.parse(request.body);
      return {ok:true,json:async()=>({access_token:"test-access",expires_in:200})};
    }});
  assert.equal(accessToken,"test-access");
  assert.equal(payload.code_verifier,"verifier");
  assert.equal(Object.hasOwn(payload,"client_secret"),false);
});

test("new Nuvio changes become watch, watchlist and paused-progress candidates",()=>{
  const candidates=buildTraktSyncCandidates(oldFiles,merged,{episodeIds:ids});
  assert.equal(candidates.unresolved.length,0);
  assert.deepEqual(candidates.watched,[{tmdb_id:"90011",type:"episode",watched_at:"2026-10-25T19:33:00.000Z"}]);
  assert.equal(candidates.watchlist[0].imdb_id,"tt7441658");
  assert.equal(candidates.playback[0].ids.tmdb,90012);
  assert.equal(candidates.playback[0].progress,62.5);
  const without=buildTraktSyncCandidates(oldFiles,merged,{episodeIds:ids,excluded:new Set(["watched:0","progress:0","library:0"])});
  assert.equal(without.watched.length+without.playback.length+without.watchlist.length,0);
});

test("unresolved episodes must be fixed, not collapsed into a whole show",()=>{
  const candidates=buildTraktSyncCandidates(oldFiles,merged);
  assert.equal(candidates.unresolved.length,2);
  assert.equal(candidates.watched.length,0);
  assert.equal(candidates.playback.length,0);
});

test("live comparison does not resend already present watches, watchlist and newer progress",async()=>{
  const candidates=buildTraktSyncCandidates(oldFiles,merged,{episodeIds:ids});
  const api=async(path)=>{
    if(path.startsWith("/sync/history"))return wrap([{type:"episode",episode:{ids:{tmdb:90011}},
      watched_at:"2026-10-25T19:33:00Z"}]);
    if(path.startsWith("/sync/watchlist/shows"))return wrap([{show:{ids:{imdb:"tt7441658"}}}]);
    if(path.startsWith("/sync/playback"))return wrap([{type:"episode",episode:{ids:{tmdb:90012}},
      paused_at:"2026-10-26T02:00:00Z",progress:50}]);
    throw new Error("unexpected: "+path);
  };
  const plan=await planTraktSync(api,candidates);
  assert.deepEqual([plan.history.length,plan.watchlist.length,plan.playback.length],[0,0,0]);
  assert.equal(plan.existingSkipped.history,1);
  assert.equal(plan.existingSkipped.playback,1);
});

test("live preview blocks unresolved media before any API requests",async()=>{
  let called=false;
  await assert.rejects(planTraktSync(async()=>{called=true;},buildTraktSyncCandidates(oldFiles,merged)),/Resolve or explicitly exclude/);
  assert.equal(called,false);
});

test("sync submits history/watchlist in batches, pauses unfinished playback; confirms responses",async()=>{
  const candidates=buildTraktSyncCandidates(oldFiles,merged,{episodeIds:ids});
  const calls=[];
  const api=async(path,{method,body}={})=>{
    assert.equal(method,"POST");
    calls.push({path,body});
    if(path==="/sync/history")return wrap({added:{movies:0,episodes:1}});
    if(path==="/sync/watchlist")return wrap({added:{shows:1,movies:0}});
    if(path==="/scrobble/pause")return wrap({action:"pause"});
    throw Error(path);
  };
  const report=await executeTraktSync(api,{history:candidates.watched,watchlist:candidates.watchlist,playback:candidates.playback});
  assert.deepEqual([report.history,report.watchlist,report.playback],[1,1,1]);
  assert.equal(calls[0].body.episodes[0].ids.tmdb,90011);
  assert.equal(calls[1].body.shows[0].ids.imdb,"tt7441658");
  assert.equal(calls[2].body.episode.ids.tmdb,90012);
  assert.equal(calls[2].body.progress,62.5);
  assert.equal(calls.some(x=>x.path.includes("/remove")||x.path.includes("/stop")),false);
});

test("API access token never appears in request bodies or query parameters",async()=>{
  const api=makeTraktApi({clientId:"public-client",accessToken:"secret-token",fetchImpl:async(url,opts)=>{
    assert.equal(url,"https://api.trakt.tv/users/settings");
    assert.equal(opts.headers.Authorization,"Bearer secret-token");
    assert.equal(opts.headers["trakt-api-key"],"public-client");
    assert.equal(opts.body,undefined);
    return {ok:true,json:async()=>({user:{username:"tester"}})};
  }});
  const response=await api("/users/settings");
  assert.equal(response.body.user.username,"tester");
});


test("newer live Trakt watch prevents re-adding stale Nuvio history or resurrecting completed playback",async()=>{
  const candidates=buildTraktSyncCandidates(oldFiles,merged,{episodeIds:ids});
  const api=async(path)=>{
    if(path.startsWith("/sync/history"))return wrap([
      {type:"episode",episode:{ids:{tmdb:90011}},watched_at:"2026-10-27T12:00:00Z"},
      {type:"episode",episode:{ids:{tmdb:90012}},watched_at:"2026-10-27T12:00:00Z"},
    ]);
    if(path.startsWith("/sync/watchlist/shows"))return wrap([]);
    if(path.startsWith("/sync/playback"))return wrap([]);
    throw Error(path);
  };
  const plan=await planTraktSync(api,candidates);
  assert.equal(plan.history.length,0);
  assert.equal(plan.playback.length,0);
  assert.equal(plan.watchlist.length,1);
});


test("pause-only episode automatically reuses the episode ID found in the original Trakt history", () => {
  const show={title:"Agatha All Along",ids:{imdb:"tt15571732",tmdb:138501}};
  const source=new Map([
    ["watched-history-1.json",JSON.stringify([
      {type:"episode",show,episode:{season:1,number:5,ids:{trakt:45005,tmdb:222005}},
       watched_at:"2024-10-01T11:00:00Z"},
    ])],
    ["lists-watchlist.json","[]"],
  ]);
  const candidate=buildTraktSyncCandidates(source,{updates:new Map(),changes:{
    history:[],watchlist:[],
    playback:[{id:"progress:0",action:"add",entry:{
      type:"episode",show,episode:{season:1,number:5},
      progress:47.5,paused_at:"2026-10-20T11:00:00Z"
    }}],
  }});
  assert.equal(candidate.unresolved.length,0);
  assert.equal(candidate.playback.length,1);
  assert.deepEqual(candidate.playback[0].ids,{trakt:45005});
  assert.equal(candidate.playback[0].progress,47.5);
});

test("pause-only episodes are included in ID resolution rather than silently removed", () => {
  const show={title:"Agatha All Along",ids:{imdb:"tt15571732",tmdb:138501}};
  const source=new Map([["watched-history-1.json","[]"],["lists-watchlist.json","[]"]]);
  const merged={updates:new Map(),changes:{history:[],watchlist:[],playback:[{
    id:"progress:17",action:"add",entry:{type:"episode",show,episode:{season:1,number:6},progress:63,
      paused_at:"2026-10-20T12:00:00Z"},
  }]}};
  const unresolved=buildTraktSyncCandidates(source,merged);
  assert.equal(unresolved.playback.length,0);
  assert.equal(unresolved.unresolved.length,1);
  assert.equal(unresolved.unresolved[0].kind,"playback");
  assert.equal(unresolved.unresolved[0].reason,"Episode-specific ID required for pause sync");
  assert.deepEqual(unresolved.unresolved[0].showIds,show.ids);
  assert.equal(unresolved.unresolved[0].changeId,"progress:17");
  const episodeIds=new Map([["tmdb:138501|s1e6",{tmdb:13579024}]]);
  const resolved=buildTraktSyncCandidates(source,merged,{episodeIds});
  assert.equal(resolved.unresolved.length,0);
  assert.equal(resolved.playback[0].ids.tmdb,13579024);
  const omitted=buildTraktSyncCandidates(source,merged,{excluded:new Set(["progress:17"])});
  assert.equal(omitted.playback.length,0);
  assert.equal(omitted.unresolved.length,0);
});
