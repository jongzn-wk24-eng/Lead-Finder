import { createHash } from "node:crypto";
import type { Category } from "./defaults";
import { readOsmCache } from "../lead-db";

// Internal query/cache helpers; callers outside osm never construct tag selectors.
export function categoryQuery(category:Category,boundary:boolean){
  const selectors=category.filters.map(filter=>{
    if(!/^[a-zA-Z_:]+=[a-zA-Z0-9_:.-]+$/.test(filter))throw new Error(`Invalid category filter: ${filter}`);
    const [key,value]=filter.split("=");return `["${key}"="${value}"]["name"]`;
  });
  return `[out:json][timeout:60];${boundary?'area["name"="Kuala Lumpur"]["boundary"="administrative"]->.kl;':""}(${selectors.map(s=>`nwr${s}${boundary?"(area.kl)":"(3.04,101.60,3.27,101.80)"};`).join("")});out center tags;`;
}
export async function categoryIsCached(category:Category,endpoint:string){
  for(const boundary of [true,false]){
    const hash=createHash("sha256").update(new URL(endpoint).href+categoryQuery(category,boundary)).digest("hex");
    const data=await readOsmCache(hash);
    if(data&&Array.isArray(data.elements)&&(!boundary||data.elements.length>0))return true;
  }
  return false;
}
