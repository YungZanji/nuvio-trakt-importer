// One-time browser-only Trakt migration. No passwords, secrets, or account tokens are persisted.
import { buildTraktImportJson, buildTraktEpisodeIdIndex } from "./trakt-import-json.mjs";

const API_BASE = "https://api.trakt.tv";
const AUTH_BASE = "https://auth.trakt.tv";
const mediaKey = (type, ids) => {
  const keys = Object.entries(ids || {}).filter(([k,v]) =>
    ["trakt","imdb","tmdb","tvdb"].includes(k) && v !== undefined && v !== null && String(v) !== "");
  return keys.map(([k,v]) => type + "|" + k + ":" + String(v).toLowerCase());
};
const normalizedId = (item) => {
  for (const field of ["trakt_id","imdb_id","tmdb_id","tvdb_id"]) {
    if (item[field]) return { [field.slice(0,-3)]: field === "imdb_id" ? String(item[field]) : Number(item[field]) };
  }
  return null;
};
const rowKeys = (row) => mediaKey(row.type, normalizedId(row));
const iso = (v) => { const ms=Date.parse(v||""); return Number.isFinite(ms)?new Date(ms).toISOString():null; };
const sortDedupe = (rows) => {
  const map = new Map();
  for(const row of rows){
    const key = rowKeys(row)[0] + "|" + (row.watched_at || row.watchlisted_at || "");
    if(!map.has(key))map.set(key,row);
  }
  return [...map.values()];
};

function episodePlaybackIds(row, episodeIds) {
  const ids = row?.episode?.ids;
  if(ids && Object.keys(ids).some(k=>["trakt","tmdb","imdb","tvdb"].includes(k)))return ids;
  const show = row?.show?.ids || {};
  const season = Number(row?.episode?.season), number=Number(row?.episode?.number);
  for(const [source,id] of Object.entries(show)){
    const value=episodeIds.get(source+":"+String(id).toLowerCase()+"|s"+season+"e"+number);
    if(value)return value;
  }
  return null;
}

/** Builds requests from the exact selected Nuvio changes, never from all original Trakt records. */
export function buildTraktSyncCandidates(textFiles, merged, {excluded=new Set(),episodeIds=new Map(),selectedChangeIds=null}={}) {
  // The UI's displayed proposed-change IDs are the authoritative allowlist for sync.
  // A prior live plan cannot silently re-include a checkbox that was unchecked.
  const effectiveExcluded=new Set(excluded);
  if(selectedChangeIds){
    const selected=new Set(selectedChangeIds);
    for(const group of Object.values(merged.changes || {}))
      for(const item of group || []) if(!selected.has(item.id)) effectiveExcluded.add(item.id);
  }
  const effectiveEpisodeIds=new Map([...buildTraktEpisodeIdIndex(textFiles),...episodeIds]);
  const converted=buildTraktImportJson(textFiles,merged,{scope:"new",excluded:effectiveExcluded,episodeIds:effectiveEpisodeIds});
  const watched=sortDedupe(converted.rows.filter(r=>r.watched_at));
  const watchlist=sortDedupe(converted.rows.filter(r=>r.watchlisted_at));
  const playback=[];
  const unresolved=[...converted.unresolved];
  for(const change of merged.changes.playback || []){
    if(effectiveExcluded.has(change.id)||change.action==="clear")continue; // remote deletions never performed
    const entry=change.entry, progress=Number(entry?.progress);
    if(!(progress>0&&progress<100)||!iso(entry?.paused_at))continue;
    const isEpisode=entry.type==="episode";
    const ids=isEpisode?episodePlaybackIds(entry,effectiveEpisodeIds):entry?.movie?.ids;
    if(!ids || !mediaKey(isEpisode?"episode":"movie",ids).length){
      unresolved.push({
        changeId:change.id,kind:"playback",
        reason:isEpisode?"Episode-specific ID required for pause sync":"Movie ID required for pause sync",
        title:entry?.show?.title||entry?.movie?.title||"Unknown",
        showIds:isEpisode?(entry?.show?.ids||null):null,
        season:entry?.episode?.season??null,episode:entry?.episode?.number??null,
      });
      continue;
    }
    playback.push({type:isEpisode?"episode":"movie",ids,progress,paused_at:iso(entry.paused_at),changeId:change.id});
  }
  // /scrobble/pause rejects progress above the Trakt completion threshold.
  // Never issue /scrobble/stop instead: it would mark unfinished media as watched.
  // Keep these in the ZIP backup with their real percentage, and disclose them.
  const unsupportedPlayback=playback.filter(item=>item.progress>=80);
  const safePlayback=playback.filter(item=>item.progress<80);
  return { watched,watchlist,playback:safePlayback,unsupportedPlayback,unresolved };
}

function randomBase64Url(bytes=32) {
  const array=new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
export async function createTraktAuthorization({clientId,redirectUri}) {
  if(!/^[a-z0-9_-]{10,256}$/i.test(clientId||""))throw new Error("Enter a valid Trakt application Client ID.");
  if(!/^https:\/\/[a-z0-9.-]+\//i.test(redirectUri))throw new Error("An HTTPS callback is required.");
  const verifier=randomBase64Url(48),state=randomBase64Url(24);
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
  const url=new URL(AUTH_BASE+"/oauth/authorize");
  for(const [key,value] of Object.entries({
    response_type:"code",client_id:clientId,redirect_uri:redirectUri,state,
    code_challenge:challenge,code_challenge_method:"S256",
  }))url.searchParams.set(key,value);
  return {url:url.toString(),verifier,state,redirectUri,clientId};
}

async function fetchJson(url,init={},fetchImpl=fetch) {
  const response=await fetchImpl(url,{cache:"no-store",...init});
  let body=null;
  try{body=await response.json();}catch{}
  if(!response.ok){
    const detail=typeof body?.error==="string"?body.error:JSON.stringify(body?.error||body?.message||"");
    const error=new Error("Trakt "+response.status+(detail?" "+detail:""));
    error.status=response.status;
    throw error;
  }
  return {body,response};
}
export async function exchangeTraktCode({code,verifier,clientId,redirectUri,fetchImpl=fetch}) {
  if(!code || !verifier)throw new Error("OAuth callback is missing the authorization code.");
  const {body}=await fetchJson(AUTH_BASE+"/oauth/token",{
    method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify({code,client_id:clientId,redirect_uri:redirectUri,
      code_verifier:verifier,grant_type:"authorization_code"}),
  },fetchImpl);
  if(!body?.access_token)throw new Error("Trakt did not return an access token.");
  return {accessToken:body.access_token,expiresAt:Date.now()+(Number(body.expires_in)||3600)*1000};
}

export function makeTraktApi({clientId,accessToken,fetchImpl=fetch}) {
  if(!clientId||!accessToken)throw new Error("Trakt sign-in is required.");
  const headers={"Content-Type":"application/json","trakt-api-version":"2",
    "trakt-api-key":clientId,Authorization:"Bearer "+accessToken};
  return async(path,{method="GET",body}={})=>{
    if(!path.startsWith("/") || path.startsWith("//"))throw new Error("Invalid Trakt API path");
    return fetchJson(API_BASE+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})},fetchImpl);
  };
}
async function paginated(api,path,limit=100) {
  const all=[];
  for(let page=1;page<=300;page++){
    const sep=path.includes("?")?"&":"?";
    const {body,response}=await api(path+sep+"page="+page+"&limit="+limit);
    if(!Array.isArray(body))throw new Error("Unexpected Trakt response for "+path);
    all.push(...body);
    const pages=Number(response.headers?.get?.("x-pagination-page-count"));
    if(pages>0){if(page>=pages)return all;continue;}
    if(body.length<limit)return all;
  }
  throw new Error("Too many Trakt results; sync aborted rather than comparing an incomplete account.");
}

function remoteKeys(entry) {
  const obj=entry.type==="episode"?entry.episode:entry.type==="movie"?entry.movie:entry.show;
  const type=entry.type|| (entry.episode?"episode":entry.movie?"movie":"show");
  return mediaKey(type,obj?.ids);
}
function overlaps(keys,set){return keys.some(key=>set.has(key));}
const mapRemote=(entries)=>new Map(entries.flatMap(row=>
  remoteKeys(row).map(key=>[key,row])));

/** Read-only live comparison, always performed before any account writes. */
export async function planTraktSync(api,candidates,{acknowledged={history:new Set(),watchlist:new Set(),playback:new Set()}}={}) {
  if(candidates.unresolved.length)throw new Error("Resolve or explicitly exclude "+candidates.unresolved.length+" unmatched items before syncing.");
  const start=[...candidates.watched.map(r=>iso(r.watched_at)),...candidates.playback.map(r=>iso(r.paused_at))].filter(Boolean).sort()[0];
  const historyPath="/sync/history"+(start?"?start_at="+encodeURIComponent(start):"");
  const [history,watchMovies,watchShows,playback]=await Promise.all([
    (candidates.watched.length||candidates.playback.length)?paginated(api,historyPath):Promise.resolve([]),
    candidates.watchlist.some(r=>r.type==="movie")?paginated(api,"/sync/watchlist/movies"):Promise.resolve([]),
    candidates.watchlist.some(r=>r.type==="show")?paginated(api,"/sync/watchlist/shows"):Promise.resolve([]),
    candidates.playback.length?paginated(api,"/sync/playback"):Promise.resolve([]),
  ]);
  const watches=new Set();
  const watchedLatest=new Map();
  for(const item of history){
    const time=iso(item.watched_at);
    if(!time)continue;
    for(const key of remoteKeys(item)){
      watches.add(key+"|"+time);
      watchedLatest.set(key,Math.max(watchedLatest.get(key)||0,Date.parse(time)));
    }
  }
  const additions=candidates.watched.filter(row=>
    !acknowledged.history.has(JSON.stringify(row)) &&
    !rowKeys(row).some(k=>
      watches.has(k+"|"+iso(row.watched_at)) || (watchedLatest.get(k)||0) >= Date.parse(row.watched_at)
    )
  );
  const listed=new Set([...watchMovies,...watchShows].flatMap(remoteKeys));
  const listAdditions=candidates.watchlist.filter(row=>
    !acknowledged.watchlist.has(JSON.stringify(row)) && !overlaps(rowKeys(row),listed)
  );
  const existing=mapRemote(playback);
  const pauses=candidates.playback.filter(item=>{
    if(acknowledged.playback.has(item.changeId+"|"+item.progress))return false;
    if(mediaKey(item.type,item.ids).some(key=>(watchedLatest.get(key)||0)>=Date.parse(item.paused_at)))return false;
    const stored=item.ids && mediaKey(item.type,item.ids).map(k=>existing.get(k)).find(Boolean);
    if(!stored)return true;
    const oldTime=Date.parse(stored.paused_at||"")||0;
    const newTime=Date.parse(item.paused_at||"")||0;
    return newTime>oldTime && Math.abs(Number(stored.progress||0)-item.progress)>=0.01;
  });
  return {history:additions,watchlist:listAdditions,playback:pauses,
    unsupportedPlayback:[...(candidates.unsupportedPlayback||[])],
    existingSkipped:{history:candidates.watched.length-additions.length,
      watchlist:candidates.watchlist.length-listAdditions.length,
      playback:candidates.playback.length-pauses.length}};
}

const chunks=(arr,size)=>Array.from({length:Math.ceil(arr.length/size)},(_,i)=>arr.slice(i*size,(i+1)*size));
function historyObject(row){return {watched_at:row.watched_at,ids:normalizedId(row)};}
function watchlistObject(row){return {listed_at:row.watchlisted_at,ids:normalizedId(row)};}

/** Apply only after explicit user confirmation. Halt on API failure; report partial writes honestly. */
export async function executeTraktSync(api,plan,{onProgress=()=>{},onConfirmed=()=>{},sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const report={history:0,watchlist:0,playback:0,notFound:[],errors:[]};
  // Trakt Standard auth write rate limit: 1 request per second. Space writes
  // before EACH later call, including scrobble/pause.
  let nextAllowed=0;
  const post=async(path,body)=>{
    const remaining=Math.max(0,nextAllowed-Date.now());
    if(remaining)await sleep(remaining);
    nextAllowed=Date.now()+1150;
    return api(path,{method:"POST",body});
  };
  const deliver=async(path,kind,groups)=>{
    for(const group of chunks(groups,25)){
      const {body}=await post(path,kind==="history"?
        {movies:group.filter(r=>r.type==="movie").map(historyObject),
         episodes:group.filter(r=>r.type==="episode").map(historyObject)}:
        {movies:group.filter(r=>r.type==="movie").map(watchlistObject),
         shows:group.filter(r=>r.type==="show").map(watchlistObject)});
      report.notFound.push(...(body?.not_found?.movies||[]),...(body?.not_found?.shows||[]),...(body?.not_found?.episodes||[]));
      const category=body?.added;
      if(!category || typeof category!=="object")throw new Error("Trakt did not confirm "+kind+" changes; halted to avoid repeats.");
      const accepted=Number(category.movies||0)+Number(category.shows||0)+Number(category.episodes||0);
      report[kind]+=accepted;
      // Only trust a complete accepted batch for retry suppression; mixed
      // not_found responses require a fresh live comparison.
      if(accepted===group.length && !(body?.not_found?.movies?.length||body?.not_found?.shows?.length||body?.not_found?.episodes?.length)){
        onConfirmed(kind,group);
      }
      onProgress({...report});
    }
  };
  await deliver("/sync/history","history",plan.history);
  await deliver("/sync/watchlist","watchlist",plan.watchlist);
  for(const item of plan.playback){
    if(item.progress>=80)throw new Error("Refusing to mark unfinished media watched at "+item.progress+"%. Playback at or above 80% cannot be restored exactly via Trakt pause; retain it in the ZIP.");
    const {body}=await post("/scrobble/pause",{
      [item.type]:{ids:item.ids},progress:item.progress,
    });
    if(body?.action!=="pause")throw new Error("Trakt did not confirm pause for "+item.changeId);
    report.playback++;
    onConfirmed("playback",[item]);
    onProgress({...report});
  }
  return report;
}
