import { importCategory } from "./index";
import { getSettings,upsertOsmBusiness,recomputeOsmValues,recordOsmImport } from "../lead-db";
import { pool } from "@workspace/db";
const settings=await getSettings();
const category=settings.categories.find(c=>c.label==="Dental clinic")!;
let requests=0;
try{
  const records=await importCategory(category,{onRequest:async()=>{requests++;},onSummary:summary=>console.info(JSON.stringify({test:"dental-summary",...summary}))});
  let newCount=0;
  for(const b of records)if((await upsertOsmBusiness(b)).isNew)newCount++;
  await recomputeOsmValues();
  await recordOsmImport(category.label,requests,records.length);
  console.info(JSON.stringify({test:"dental-persisted",found:records.length,newCount,withWebsite:records.filter(b=>b.websiteUrl).length,withPhone:records.filter(b=>b.phone).length,withEmail:records.filter(b=>b.email).length,requests}));
}finally{await pool.end();}
