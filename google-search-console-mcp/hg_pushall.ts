import 'dotenv/config';
import { GoogleSearchConsoleClient } from './src/client.js';
import { writeFileSync } from 'fs';
const B = "https://haorgrix.com";
const loc: [string,string][] = [
  ["bahrain","ai-automation"],["qatar","ai-automation"],["cyprus","custom-software"],["malaysia","cloud-migration"],
  ["dublin","cloud-migration"],["guyana","custom-software"],["oman","cloud-migration"],["singapore","custom-software"],
  ["malta","custom-software"],["philippines","custom-software"],["nigeria","custom-software"],["kuwait","growth-marketing"],
  ["saudi-arabia","ai-automation"],["sri-lanka","custom-software"],["bangladesh","custom-software"],["egypt","digital-marketing"],
  ["mauritius","custom-software"],["kenya","custom-software"],
];
const regions = [...new Set(loc.map(l=>l[0]))];
const urls = [`${B}/insights`, ...regions.map(r=>`${B}/insights/${r}`), ...loc.map(([r,s])=>`${B}/locations/${r}/${s}`)];
(async () => {
  const c = new GoogleSearchConsoleClient();
  let ok=0; const log:any[]=[];
  for (const u of urls) {
    try { await c.submitUrlForIndexing(u,"URL_UPDATED"); ok++; log.push({u,ok:true}); }
    catch(e:any){ log.push({u,ok:false,err:e.message}); }
  }
  writeFileSync("/Users/musfiqurtuhin/Documents/HaorGrix/Internal-Ops/SEO-Growth-Engine/queues/indexed_2026-07-13_full.json", JSON.stringify({pushed:ok, total:urls.length, log}, null, 2));
  console.log(`DONE: pushed ${ok}/${urls.length} to Indexing API`);
})().catch(e=>console.error("ERR",e.message));
