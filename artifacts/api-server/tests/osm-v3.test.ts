import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone,normalizeWebsite,normalizeElement } from "../src/lib/osm/normalize";
import { CATEGORIES,AREA_CENTRES } from "../src/lib/osm/defaults";
import { importCategory } from "../src/lib/osm";
import { getCompany,updateCompany,getSettings,updateSettings,upsertOsmBusiness,recomputeOsmValues,markDoNotContact,
  generateDraft,logCopiedMessage,markMessageSent,logReply,saveWebsiteCheck,updateLatestDesignResult,listCompanies,
  exportCompaniesCsv,exportOutreachCsv,getDashboard,listFollowups,leadDb,createCompany,loadDemoData,deleteSampleData } from "../src/lib/lead-db";
import { withDataMode } from "../src/lib/lead-postgres";
import { searchGooglePlacesText } from "../src/lib/google-places";
import { checkCompanyWebsite } from "../src/lib/website-checks";
import { generateOutreachDraft,GeminiQuotaError } from "../src/lib/gemini-ai";
import { pool } from "@workspace/db";

test("OSM v3 and outreach safety — isolated PostgreSQL schema, no external requests",async t=>{
  const original=globalThis.fetch;let requests=0;
  const category=CATEGORIES[0]!;
  const fixture=[1,2].map((n)=>({type:"node",id:900000000+n,lat:3.158+n*0.0001,lon:101.712,tags:{name:"Fixture Dental",amenity:"dentist",phone:"03-2123 4567","contact:mobile":"012-345 6789",website:"example.com",email:"HELLO@example.com"}}));
  await updateSettings({osmContact:"https://example.com/contact",myName:"Test Sender",myWhatsapp:"+60123456789",portfolioUrl:"https://example.com",emailDailyLimit:100,followup1Days:4,followup2Days:10});
  globalThis.fetch=async(url,init)=>{
    assert.ok(String(url).includes("overpass"));
    assert.ok(new Headers(init?.headers).get("User-Agent")?.includes("https://example.com/contact"));
    const query=new URLSearchParams(String(init?.body)).get("data")!;
    assert.ok(query.includes('["amenity"="dentist"]["name"]'));
    assert.ok(query.endsWith("out center tags;"));requests++;
    return Response.json({elements:fixture});
  };
  try{
    await t.test("phone normalization covers all requested Malaysian examples",()=>{
      for(const [input,expected] of [["03-2123 4567","+60321234567"],["012-345 6789","+60123456789"],["+60 12-345 6789","+60123456789"],["60123456789","+60123456789"],["0123456789","+60123456789"]])assert.equal(normalizePhone(input!),expected);
      assert.equal(normalizePhone("not a phone"),null);
    });
    await t.test("website and social normalization",()=>{
      assert.equal(normalizeWebsite("example.com").websiteUrl,"https://example.com/");
      assert.deepEqual(normalizeWebsite("https://www.facebook.com/abc"),{websiteUrl:null,socialUrl:"https://www.facebook.com/abc",websiteType:"social"});
      assert.equal(normalizeWebsite("").websiteType,"unknown");
    });
    await t.test("lifecycle, public schools, invalid names and outside-box records are filtered",()=>{
      assert.equal(normalizeElement({...fixture[0]!,tags:{...fixture[0]!.tags,"disused:amenity":"dentist"}},category,AREA_CENTRES).skipped,"Closed or disused");
      assert.equal(normalizeElement({...fixture[0]!,tags:{name:"SK Bangsar"}},CATEGORIES[8]!,AREA_CENTRES).skipped,"Government school");
      assert.equal(normalizeElement({...fixture[0]!,lat:4},category,AREA_CENTRES).skipped,"Outside KL bounding box");
      assert.equal(normalizeElement({...fixture[0]!,tags:{name:"123"}},category,AREA_CENTRES).skipped,"Missing or invalid name");
      assert.equal(normalizeElement(fixture[0]!,category,AREA_CENTRES).business?.phoneIsMobile,false);
    });
    let id=0;
    await t.test("first import inserts; second import uses cache and adds zero companies",async()=>{
      const first=await importCategory(category);
      let added=0;for(const b of first){const r=await upsertOsmBusiness(b);id ||=r.id;if(r.isNew)added++;}
      assert.equal(added,2);assert.equal(requests,1);
      let secondAdded=0;for(const b of await importCategory(category))if((await upsertOsmBusiness(b)).isNew)secondAdded++;
      assert.equal(secondAdded,0);assert.equal(requests,1);
      await recomputeOsmValues();
      assert.equal((await getCompany(id))!.valueScore,22);
      assert.ok((await getCompany(id))!.duplicateWarning);
    });
    await t.test("manual phone survives refresh; manual rating and branch bonus cap at30",async()=>{
      await updateCompany(id,{phone:"+60198887777",manualValue:3});
      for(const b of await importCategory(category))await upsertOsmBusiness(b);
      await recomputeOsmValues();
      assert.equal((await getCompany(id))!.phone,"+60198887777");
      assert.equal((await getCompany(id))!.valueScore,30);
    });
    await t.test("missing website is unknown/0, never proof of no website; confirmation gives50",async()=>{
      const b=normalizeElement({...fixture[0]!,id:900000099,tags:{name:"Unknown Dental"}},category,AREA_CENTRES).business!;
      const r=await upsertOsmBusiness(b);await checkCompanyWebsite(r.id);
      assert.equal((await getCompany(r.id))!.problemScore,0);
      assert.equal((await getCompany(r.id))!.websiteType,"unknown");
      assert.ok("error" in await generateDraft(r.id));
      await updateCompany(r.id,{websiteConfirmedNone:true});await checkCompanyWebsite(r.id);
      assert.equal((await getCompany(r.id))!.problemScore,50);
      const draft=await generateDraft(r.id);
      assert.ok(!("error" in draft));
      if(!("error" in draft)){
        assert.equal(draft.draftMode,"template");assert.ok(draft.emailBody.includes(b.name));
        assert.ok(draft.emailBody.split(/\s+/).length<100);assert.ok(draft.whatsappBody.split(/\s+/).length<=40);
        assert.equal(draft.canOpenWhatsapp,false);
      }
    });
    await t.test("design uses0..10 high-is-good thresholds and CTA",async()=>{
      await saveWebsiteCheck(id,{websiteType:"own",psiMobileScore:80,lcpSeconds:2,https:true,hasViewport:true,copyrightYear:2026,hasTelLink:true,hasWhatsappLink:true,hasContactForm:true,hasContactPage:true,siteBuilder:null,retryCount:0,checkStatus:"completed",lastError:null,screenshotDesktopPath:null,screenshotMobilePath:null,problemScore:7,reasons:["Mobile PageSpeed performance score is 80/100."],findingType:"slow_mobile",email:null,whatsapp:null});
      await updateLatestDesignResult({companyId:id,status:"completed",score:4,ctaObvious:false,reasons:["The call action is hard to find."]});
      assert.equal((await getCompany(id))!.problemScore,27);
      await updateLatestDesignResult({companyId:id,status:"completed",score:8,ctaObvious:true,reasons:["Clear layout."]});
      assert.equal((await getCompany(id))!.problemScore,7);
      await updateLatestDesignResult({companyId:id,status:"pending",message:"Quota reached"});
      assert.equal((await getCompany(id))!.checks[0]?.designStatus,"pending");
    });
    await t.test("Do not contact survives import, reply and status paths; cannot draft, copy or marksent",async()=>{
      await markDoNotContact(id);
      for(const b of await importCategory(category))await upsertOsmBusiness(b);
      await logReply(id,"Test reply");
      assert.equal((await getCompany(id))!.status,"Do not contact");
      assert.ok(!(await listCompanies({showAll:true})).some(c=>c.id===id));
      await assert.rejects(logCopiedMessage(id,"email"));
      assert.ok("error" in await generateDraft(id));assert.ok("error" in (await markMessageSent(id,{channel:"email",sequenceNo:1,body:"test"}))!);
    });
    await t.test("follow-up dates use initial send, three-email cap, reply stats and CSV attribution",async()=>{
      const c=(await createCompany({name:"=CRM fixture",websiteUrl:"example.com",findingType:"A manual finding."}))!;
      await markMessageSent(c.id,{channel:"email",sequenceNo:1,body:"test"});
      const reminder=(await listFollowups()).find(r=>Number(r.companyId)===c.id)!;
      assert.ok(Math.abs(Date.parse(String(reminder.dueAt))-Date.now()-4*86400_000)<10000);
      const followup=await generateDraft(c.id);assert.ok(!("error" in followup)&&followup.emailBody.includes("Just checking"));
      await markMessageSent(c.id,{channel:"email",sequenceNo:2,body:"test"});
      const finalDue=(await listFollowups()).find(r=>Number(r.companyId)===c.id)!;
      assert.ok(Math.abs(Date.parse(String(finalDue.dueAt))-Date.now()-10*86400_000)<10000);
      await markMessageSent(c.id,{channel:"email",sequenceNo:3,body:"test"});
      assert.equal((await getCompany(c.id))!.status,"Closed: no reply");
      assert.ok("error" in (await markMessageSent(c.id,{channel:"email",sequenceNo:4,body:"test"}))!);
      await logReply(c.id,"Reply");
      assert.ok((await getDashboard()).replyRatesByChannel.some(r=>r.channel==="email"&&r.replied>0));
      assert.ok((await exportCompaniesCsv()).includes("'=CRM fixture"));
      for(const csv of [await exportCompaniesCsv(),await exportOutreachCsv()])assert.ok(csv.startsWith("\uFEFF# Map data © OpenStreetMap contributors (ODbL)"));
    });
    await t.test("large chains get no branch bonus and are hidden only by default",async()=>{
      for(let n=3;n<=8;n++)await upsertOsmBusiness(normalizeElement({...fixture[0]!,id:900000000+n,lat:3.158+n*.0001},category,AREA_CENTRES).business!);
      await recomputeOsmValues();
      const rows=await listCompanies({showAll:true});assert.ok(rows.some(c=>c.isChain&&c.branchCount===8));
      assert.ok(!(await listCompanies()).some(c=>c.isChain));
    });
    await t.test("parallel mark-sent attempts cannot duplicate a sequence; daily warning does not hide an actual manual send",async()=>{
      const c=(await createCompany({name:"Concurrency fixture",websiteUrl:"example.com",findingType:"Manual observation."}))!;
      await updateSettings({emailDailyLimit:1});
      const results=await Promise.all([1,2].map(()=>markMessageSent(c.id,{channel:"email",sequenceNo:1,body:"Already sent manually."})));
      assert.equal(results.filter(r=>r&&!("error" in r)).length,1);
      assert.equal((await getCompany(c.id))!.emailCount,1);
    });
    await t.test("explicitly cleared manual contact fields remain cleared after website enrichment",async()=>{
      const c=(await createCompany({name:"Contact fixture",websiteUrl:"example.com",findingType:"Verified manual finding."}))!;
      await updateCompany(c.id,{email:"",whatsapp:"",firstName:"",notes:"",phone:"+60123456789"});
      assert.equal((await getCompany(c.id))!.firstName,"");
      assert.equal((await getCompany(c.id))!.phone,"+60123456789");
      await saveWebsiteCheck(c.id,{websiteType:"own",psiMobileScore:80,lcpSeconds:2,https:true,hasViewport:true,copyrightYear:2026,hasTelLink:true,hasWhatsappLink:true,hasContactForm:true,hasContactPage:true,siteBuilder:null,retryCount:0,checkStatus:"completed",lastError:null,screenshotDesktopPath:null,screenshotMobilePath:null,problemScore:7,reasons:["Measured finding."],findingType:"slow_mobile",email:"auto@example.com",whatsapp:"+60123456789"});
      assert.equal((await getCompany(c.id))!.email,null);
      assert.equal((await getCompany(c.id))!.whatsapp,null);
    });
    await t.test("demo fixtures are explicit, repeatable, isolated and deletable without touching real records",async()=>{
      const before=(await getDashboard()).totals.companies;
      await loadDemoData();
      await withDataMode(true,async()=>{
        const demo=await listCompanies({showAll:true});assert.ok(demo.length>=25);assert.ok(demo.every(c=>c.source==="demo"));
      });
      await loadDemoData();assert.equal((await getDashboard()).totals.companies,before);
      await deleteSampleData();assert.equal((await getDashboard()).totals.companies,before);
      await withDataMode(true,async()=>assert.equal((await listCompanies({showAll:true})).length,0));
    });
    await t.test("legacy Google adapter refuses before network and quota accounting",async()=>{
      let charged=false;await assert.rejects(searchGooglePlacesText("dental","KL",()=>{charged=true;}),/disabled/);
      assert.equal(charged,false);
    });
    await t.test("blank OSM contact refuses before network",async()=>{
      await updateSettings({osmContact:""});
      await assert.rejects(importCategory(category),/contact/);
      assert.equal(requests,1);
    });
    await t.test("invalid AI output falls back to a short fact-based template",async()=>{
      process.env.GEMINI_API_KEY="test-placeholder";
      globalThis.fetch=async()=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify({subject:"Wrong company",emailBody:"I guarantee 100% more enquiries!",whatsappBody:"WRONG COMPANY AND FINDING"})}]}}]});
      const c=(await createCompany({name:"AI fixture",websiteUrl:"example.com",findingType:"A verified manual finding."}))!;
      const draft=await generateDraft(c.id);
      assert.ok(!("error" in draft));
      if(!("error" in draft)){assert.equal(draft.draftMode,"template");assert.ok(draft.emailBody.includes(c.name));assert.ok(draft.emailBody.includes(draft.finding));assert.ok(!/guarantee|100%/i.test(draft.emailBody));assert.ok(draft.whatsappBody.split(/\s+/).length<=40);}
    });
    await t.test("429 cooldown prevents repeated Gemini requests",async()=>{
      process.env.GEMINI_API_KEY="test-placeholder";
      let calls=0;
      globalThis.fetch=async()=>{calls++;return Response.json({}, {status:429,headers:{"retry-after":"60"}});};
      const input={companyName:"Fixture",area:"KL",keyword:"dental",finding:"A real finding.",aiInstruction:"",senderName:"Sender",senderTitle:"Designer",portfolioUrl:"https://example.com",whatsappNumber:"test"};
      await assert.rejects(generateOutreachDraft(input),GeminiQuotaError);
      await assert.rejects(generateOutreachDraft(input),GeminiQuotaError);
      assert.equal(calls,1);
    });
  }finally{globalThis.fetch=original;await pool.end();}
});
