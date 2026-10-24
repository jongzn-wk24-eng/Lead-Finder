import { getSettings,getCompany,leadDb,upsertOsmBusiness,recomputeOsmValues,recordOsmImport } from "./lead-db";
import { importCategory, type ImportSummary } from "./osm";
import { createResearchJob,updateResearchJob,cancellationRequested,incrementRequestCount,withWebsiteCheckLimit } from "./research-jobs";
import { checkCompanyWebsite } from "./website-checks";
import { inDemoMode } from "./lead-postgres";
import { categoryIsCached } from "./osm/cache-info";
type Input={areas?:string[];keywords:string[];refresh?:boolean};
async function selected(input:Input){
  const settings=await getSettings();
  const labels=[...new Set(input.keywords)];
  if(!labels.length||labels.length>30)throw new Error("Choose between 1 and 30 categories.");
  const categories=labels.map(label=>settings.categories.find(c=>c.label===label));
  if(categories.some(c=>!c))throw new Error("Choose categories from Settings.");
  return {settings,categories:categories.map(c=>c!)};
}
export async function estimateOsmSearch(input:Input) {
  const {categories,settings}=await selected(input);
  const cachedCategories:string[]=[];
  if(!input.refresh)for(const c of categories)if(await categoryIsCached(c,settings.overpassEndpoint))cachedCategories.push(c.label);
  const queriesPlanned=categories.length-cachedCategories.length;
  return {areaCount:1,keywordCount:categories.length,pairCount:categories.length,requestsEstimated:queriesPlanned*4,maxResultsPerPair:0,maximumPairs:30,queriesPlanned,cachedCategories,
    strategy:"One union query per category across Kuala Lumpur. Cached responses under 24 hours use no network calls. At most 4 requests/category including boundary fallback and one retry per query; queries are at least 5 seconds apart."};
}
export async function startOsmSearch(input:Input,kind:"osm_import"|"osm_refresh"="osm_import"){
  if(inDemoMode())throw new Error("Switch Demo mode off before importing real businesses.");
  const {settings,categories}=await selected(input);
  if(!settings.osmContact.trim())throw new Error("Add your email or website as the OSM contact in Settings first.");
  const estimate=await estimateOsmSearch(input);
  const job=await createResearchJob(kind,categories.length,estimate.requestsEstimated,input);
  void (async()=>{
    const summary:ImportSummary={found:0,newCount:0,duplicates:0,filtered:0,withWebsite:0,withPhone:0,withEmail:0,cached:true,filterReasons:{},warnings:[]};
    const ids=new Set<number>();let completed=0;
    try {
      await updateResearchJob(job.id,{status:"running",phase:"importing",summary});
      for(const category of categories){
        if(await cancellationRequested(job.id))break;
        let requests=0;let categorySummary:ImportSummary|undefined;
        await updateResearchJob(job.id,{currentLabel:`Importing ${category.label}`});
        const records=await importCategory(category,{refresh:input.refresh,cancelled:()=>cancellationRequested(job.id),onRequest:async()=>{requests++;await incrementRequestCount(job.id);},onSummary:s=>{categorySummary=s;}});
        for(const b of records){
          const saved=await upsertOsmBusiness(b);ids.add(saved.id);
          if(saved.isNew)summary.newCount++;else summary.duplicates++;
        }
        if(categorySummary){
          for(const key of ["found","filtered","withWebsite","withPhone","withEmail"] as const)summary[key]+=categorySummary[key];
          summary.cached&&=categorySummary.cached;summary.warnings.push(...categorySummary.warnings);
          for(const [reason,n] of Object.entries(categorySummary.filterReasons))summary.filterReasons[reason]=(summary.filterReasons[reason]??0)+n;
        }
        await recordOsmImport(category.label,requests,records.length);
        await updateResearchJob(job.id,{completed:++completed,newCompanies:summary.newCount,updatedCompanies:summary.duplicates,summary});
      }
      await recomputeOsmValues();
      const toCheck:number[]=[];
      for(const id of ids){
        const c=await getCompany(id);
        if(c&&!c.isDoNotContact&&(!c.automatedCheckedAt||Date.now()-Date.parse(c.automatedCheckedAt)>30*86400_000))toCheck.push(id);
      }
      await updateResearchJob(job.id,{phase:"checking",total:completed+toCheck.length,summary});
      let index=0,failed=0;
      const worker=async()=>{
        while(index<toCheck.length&&!await cancellationRequested(job.id)){
          const id=toCheck[index++]!;
          const c=await getCompany(id);await updateResearchJob(job.id,{currentLabel:`Checking ${c?.name??"website"}`});
          const result=await withWebsiteCheckLimit(()=>checkCompanyWebsite(id));
          if(result.failed)failed++;
          await updateResearchJob(job.id,{completed:++completed,checksFailed:failed});
        }
      };
      await Promise.all([worker(),worker()]);
      const cancelled=await cancellationRequested(job.id);
      await updateResearchJob(job.id,{status:cancelled?"cancelled":"completed",phase:cancelled?"cancelled":"completed",currentLabel:null,summary});
    }catch(error){
      await recomputeOsmValues().catch(()=>undefined);
      const cancelled=await cancellationRequested(job.id);
      await updateResearchJob(job.id,{status:cancelled?"cancelled":"failed",phase:cancelled?"cancelled":"failed",error:error instanceof Error?error.message:"Import failed.",currentLabel:null,summary});
    }
  })();
  return job;
}
export async function startOsmRecheck(id:number){
  if(inDemoMode())throw new Error("Switch Demo mode OFF before running website research.");
  const c=await getCompany(id);
  if(!c)throw new Error("Company not found.");
  if(c.isDoNotContact)throw new Error("Do not contact businesses are excluded from research actions.");
  const job=await createResearchJob("recheck",1,0,{companyId:id});
  void (async()=>{try {
    await updateResearchJob(job.id,{status:"running",phase:"checking",currentLabel:c.name});
    await withWebsiteCheckLimit(async()=>{if(!await cancellationRequested(job.id))await checkCompanyWebsite(id);});
    const cancelled=await cancellationRequested(job.id);
    await updateResearchJob(job.id,{status:cancelled?"cancelled":"completed",phase:cancelled?"cancelled":"completed",completed:cancelled?0:1,currentLabel:null});
  }catch(error){await updateResearchJob(job.id,{status:"failed",phase:"failed",error:error instanceof Error?error.message:"Website check failed.",currentLabel:null});}})();
  return job;
}
