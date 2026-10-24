import { createHash } from "node:crypto";
import { getSettings, readOsmCache, writeOsmCache } from "../lead-db";
import { normalizeElement, type Element, type NormalizedBusiness } from "./normalize";
import type { Category } from "./defaults";
import { categoryQuery } from "./cache-info";
import { logger } from "../logger";
export type { NormalizedBusiness } from "./normalize";
export type ImportSummary = { found:number; newCount:number; duplicates:number; filtered:number; withWebsite:number; withPhone:number; withEmail:number; cached:boolean; filterReasons:Record<string,number>; warnings:string[] };
let tail: Promise<unknown> = Promise.resolve();
let lastRequest = 0;
const pause = (ms:number) => new Promise(r=>setTimeout(r,ms));
type Options = { refresh?:boolean; onRequest?:()=>Promise<void>; cancelled?:()=>Promise<boolean>; onSummary?:(summary:ImportSummary)=>void };

// The application imports only this function; all OSM tag/query knowledge stays here.
export async function importCategory(category: Category, options: Options = {}): Promise<NormalizedBusiness[]> {
  const work = async () => {
    const settings = await getSettings();
    if (!settings.osmContact.trim()) throw new Error("Add your email or site as the OpenStreetMap contact in Settings before importing.");
    const endpoint = new URL(settings.overpassEndpoint);
    if (endpoint.protocol !== "https:" || !["overpass-api.de","overpass.kumi.systems","overpass.private.coffee"].includes(endpoint.hostname) || endpoint.username || endpoint.password) throw new Error("Choose a supported public HTTPS Overpass endpoint (overpass-api.de, overpass.kumi.systems or overpass.private.coffee).");
    const summary:ImportSummary = {found:0,newCount:0,duplicates:0,filtered:0,withWebsite:0,withPhone:0,withEmail:0,cached:true,filterReasons:{},warnings:[]};
    const query = (boundary:boolean) => categoryQuery(category,boundary);
    const load = async (text:string) => {
      const hash=createHash("sha256").update(endpoint.href+text).digest("hex");
      if(!options.refresh){const cached=await readOsmCache(hash);if(cached)return cached as {elements:Element[]};}
      summary.cached=false;
      for(let attempt=0;attempt<2;attempt++){
        if(await options.cancelled?.()) throw new Error("Import cancelled.");
        await pause(Math.max(0,5000-(Date.now()-lastRequest)));
        lastRequest=Date.now(); await options.onRequest?.();
        const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","User-Agent":`LeadFinder/1.0 (personal tool; contact: ${settings.osmContact.replace(/[\r\n]/g,"")})`},body:new URLSearchParams({data:text}),signal:AbortSignal.timeout(60_000)});
        if([429,504].includes(r.status)){
          if(attempt===0){await pause(30_000);continue;}
          throw new Error(`Overpass is busy (${r.status}) after one retry. Partial results are saved; try again later.`);
        }
        if(!r.ok)throw new Error(`Overpass returned HTTP ${r.status}.`);
        const data=await r.json() as {elements?:Element[];remark?:string};
        if(!Array.isArray(data.elements))throw new Error("Overpass returned an incomplete response. Partial earlier categories remain saved.");
        await writeOsmCache(hash,data);
        if(data.remark&&!data.elements.length)throw new Error(`Overpass could not complete: ${data.remark.slice(0,160)}`);
        return data as {elements:Element[];remark?:string};
      }
      throw new Error("Overpass did not complete.");
    };
    const fallbackHash=createHash("sha256").update(endpoint.href+query(false)).digest("hex");
    const fallbackCache=!options.refresh?await readOsmCache(fallbackHash):null;
    let data:{elements:Element[];remark?:string};
    try {data=fallbackCache??await load(query(true));}
    catch(error){
      if(/cancelled|busy|429|504/i.test(error instanceof Error?error.message:""))throw error;
      summary.warnings.push("Administrative boundary query failed; used the KL bounding box.");
      data=await load(query(false));
    }
    if(!data.elements.length){summary.warnings.push("Administrative boundary returned no elements; used the KL bounding box.");data=await load(query(false));}
    if(data.remark)summary.warnings.push(`Overpass returned partial data: ${data.remark.slice(0,160)}`);
    summary.found=data.elements.length;
    const records:NormalizedBusiness[]=[];const seen=new Set<string>();
    for(const e of data.elements){
      const parsed=normalizeElement(e,category,settings.areaCentres);
      if(parsed.skipped){summary.filtered++;summary.filterReasons[parsed.skipped]=(summary.filterReasons[parsed.skipped]??0)+1;continue;}
      const b=parsed.business!;const key=`${b.osmType}:${b.osmId}`;
      if(seen.has(key)){summary.duplicates++;continue;}seen.add(key);records.push(b);
    }
    summary.withWebsite=records.filter(b=>b.websiteUrl).length;summary.withPhone=records.filter(b=>b.phone).length;summary.withEmail=records.filter(b=>b.email).length;
    logger.info({provider:"OpenStreetMap",category:category.label,elements:summary.found,sampleNames:records.slice(0,3).map(b=>b.name),cached:summary.cached},"OSM category query completed");
    options.onSummary?.(summary);return records;
  };
  const result=tail.then(work,work);tail=result.catch(()=>undefined);return result;
}
