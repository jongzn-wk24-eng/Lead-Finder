import test from "node:test";
import assert from "node:assert/strict";
import {
  createCompany, exportCompaniesCsv, exportOutreachCsv, generateDraft, getCompany,
  getDashboard, leadDb, listCompanies, listActivity, listFollowups, logReply, markMessageSent,
  saveWebsiteCheck, updateLatestDesignResult, updateSettings, upsertGooglePlace,
  deleteSampleData, loadDemoData, recordGooglePlacesRequest, type WebsiteCheckInput,
} from "../src/lib/lead-db";
import { withDataMode } from "../src/lib/lead-postgres";
import { withLiveGoogleData } from "../src/lib/live-google";
import { estimateGooglePlacesRequests, searchGooglePlacesText } from "../src/lib/google-places";
import { generateOutreachDraft, GeminiQuotaError } from "../src/lib/gemini-ai";
import { pool } from "@workspace/db";

test("Real/demo isolation and all three phases (isolated PostgreSQL; network mocked)", async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected external network request in test"); };
  const companyName = "Retention Test Dental";
  const baseCheck: WebsiteCheckInput = {
    websiteType: "none", psiMobileScore: null, lcpSeconds: null, https: null,
    hasViewport: null, copyrightYear: null, hasTelLink: null, hasWhatsappLink: null,
    hasContactForm: null, hasContactPage: null, siteBuilder: null, retryCount: 0,
    checkStatus: "completed", lastError: null, screenshotDesktopPath: null,
    screenshotMobilePath: null, problemScore: 25, reasons: ["No website was listed."],
    findingType: "no_website", email: null, whatsapp: null,
  };
  try {
    await t.test("empty startup never auto-seeds; undefined rates are null", async () => {
      assert.equal((await getDashboard()).totals.companies, 0);
      assert.equal((await getDashboard()).totals.replyRate, null);
      assert.deepEqual((await getDashboard()).replyRatesByChannel, []);
    });
    const record = await upsertGooglePlace({ placeId: "test-place-id", area: "Test area", keyword: "dental" });
    await updateSettings({ myName: "Test Sender", myWhatsapp: "+60100000000", portfolioUrl: "https://example.com", emailDailyLimit: 999, followup1Days: 4, followup2Days: 10 });
    await t.test("deduplicates Place IDs and estimates unique pairs", async () => {
      assert.equal((await upsertGooglePlace({ placeId: "test-place-id", area: "Test", keyword: "test" })).id, record.id);
      assert.equal(estimateGooglePlacesRequests(["A", "A"], ["X", "Y"]).requestsEstimated, 2);
      assert.throws(() => estimateGooglePlacesRequests(Array.from({ length: 61 }, (_, i) => `${i}`), ["x"]));
    });
    await t.test("Text Search and Details use field masks; search accounting increments by one", async () => {
      globalThis.fetch = async (url, init) => {
        const mask = new Headers(init?.headers).get("X-Goog-FieldMask")!;
        assert.ok(!mask.includes("*"));
        if (String(url).includes("searchText")) {
          assert.ok(mask.includes("places.id"));
          assert.equal(JSON.parse(String(init?.body)).pageSize, 20);
          return Response.json({ places: [{ id: "test-place-id" }] });
        }
        assert.ok(mask.includes("displayName")); assert.ok(!mask.includes("places."));
        return Response.json({ id: "test-place-id", displayName: { text: companyName }, formattedAddress: "Synthetic address", nationalPhoneNumber: "Synthetic phone", websiteUri: "https://synthetic.example", rating: 4.6, userRatingCount: 250 });
      };
      const before = (await getDashboard()).googlePlacesRequestsCount;
      await searchGooglePlacesText("dental", "Test", () => recordGooglePlacesRequest("dental", "Test"));
      assert.equal((await getDashboard()).googlePlacesRequestsCount, before + 1);
      const live = await withLiveGoogleData((await getCompany(record.id))!);
      assert.equal(live.name, companyName); assert.equal(live.valueScore, 25);
      const stored = (await getCompany(record.id))!;
      assert.notEqual(stored.name, companyName);
      assert.equal(stored.websiteUrl, null); assert.equal(stored.phone, null);
      assert.equal(stored.rating, 0); assert.equal(stored.valueScore, 0);
      assert.equal((await getDashboard()).googleDetailsRequestsCount, 1);
    });
    await t.test("website/design results preserve weighted scores and record AI provenance", async () => {
      await saveWebsiteCheck(record.id, baseCheck);
      await updateLatestDesignResult({ companyId: record.id, status: "completed", score: 90, ctaObvious: false, reasons: ["The action is hard to see."] });
      assert.equal((await getCompany(record.id))!.problemScore, 43);
      assert.ok((await getCompany(record.id))!.aiModel);
      const check = (await leadDb.prepare("SELECT design_status, cta_obvious FROM checks WHERE company_id = ? ORDER BY id DESC LIMIT 1").get(record.id))!;
      assert.equal(check.design_status, "completed"); assert.equal(check.cta_obvious, 0);
      await updateLatestDesignResult({ companyId: record.id, status: "pending", message: "Quota exhausted" });
      assert.equal((await getCompany(record.id))!.problemScore, 25);
    });
    await t.test("unavailable Gemini uses fact-based templates without storing Google fields", async () => {
      const draft = await generateDraft(record.id, companyName);
      assert.ok(!("error" in draft));
      if ("error" in draft) return;
      assert.equal(draft.draftMode, "template");
      for (const body of [draft.emailBody, draft.whatsappBody]) {
        assert.ok(body.includes(companyName)); assert.ok(body.includes(draft.finding));
        assert.ok(body.trim().split(/\s+/).length < 100);
      }
    });
    let manualId = 0;
    await t.test("follow-ups, sample sizes and minimum ten-company threshold", async () => {
      const manual = (await createCompany({ name: "=Synthetic CRM test", area: "Test", keyword: "dental", findingType: "A verified manual observation." }))!;
      manualId = manual.id;
      const sent = await markMessageSent(manual.id, { channel: "email", sequenceNo: 1, body: "User-authored synthetic message" });
      assert.ok(sent && !("error" in sent));
      const reminder = (await listFollowups()).find(row => Number(row.companyId) === manual.id)!;
      assert.ok(Math.abs(new Date(String(reminder.dueAt)).getTime() - Date.now() - 4 * 86400_000) < 10_000);
      assert.deepEqual((await getDashboard()).replyRatesByChannel, []);
      for (let i = 0; i < 9; i++) {
        const item = (await createCompany({ name: `Contact ${i}`, area: "Test" }))!;
        await markMessageSent(item.id, { channel: "email", sequenceNo: 1, body: "Synthetic test" });
      }
      await leadDb.prepare("UPDATE companies SET finding_type = 'site_down' WHERE id = ?").run(manual.id);
      await logReply(manual.id, "Synthetic reply");
      const dashboard = await getDashboard();
      assert.equal(dashboard.totals.contacted, 10); assert.equal(dashboard.totals.replies, 1);
      assert.equal(dashboard.replyRatesByChannel[0]!.sent, 10);
      assert.ok(dashboard.replyRatesByFindingType.some(row => row.findingType === "manual" && row.replied === 1));
    });
    await t.test("PostgreSQL date rewrites preserve channel binds, daily limits and Malaysia date boundaries", async () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
      const midnight = Date.parse(`${today}T00:00:00+08:00`);
      const dates = [
        new Date(midnight - 1000).toISOString(),
        new Date(midnight + 1000).toISOString(),
        new Date(midnight + 86400_000).toISOString(),
      ];
      const before = await getDashboard();
      await updateSettings({
        emailDailyLimit: before.sentToday.email + 1,
        whatsappDailyLimit: before.sentToday.whatsapp + 1,
      });
      let lastCompanyId = 0;
      for (const channel of ["email", "whatsapp"] as const) {
        const company = (await createCompany({ name: `Date boundary ${channel}`, area: "Test" }))!;
        lastCompanyId = company.id;
        const sent = await markMessageSent(company.id, { channel, sequenceNo: 1, body: "Synthetic daily-limit test" });
        assert.ok(sent && !("error" in sent), `${channel}: first send should be logged`);
        const overLimit = await markMessageSent(company.id, { channel, sequenceNo: 2, body: "Must not be logged" });
        assert.ok(overLimit && "error" in overLimit, `${channel}: daily limit must reject another send`);
      }
      const sentToday = (await getDashboard()).sentToday;
      assert.equal(sentToday.email, before.sentToday.email + 1);
      assert.equal(sentToday.whatsapp, before.sentToday.whatsapp + 1);
      for (let i = 0; i < dates.length; i++) {
        await leadDb.prepare("INSERT INTO activity (company_id, timestamp, action, note) VALUES (?, ?, ?, ?)")
          .run(lastCompanyId, dates[i]!, "test_event", `Boundary event ${i}`);
        await leadDb.prepare("INSERT INTO ai_api_usage (requested_at) VALUES (?)").run(dates[i]!);
      }
      const activity = await listActivity({ companyId: lastCompanyId, date: today, limit: 1000 });
      assert.deepEqual(activity.filter(row => row.note.startsWith("Boundary event")).map(row => row.note), ["Boundary event 1"]);
      assert.equal((await getDashboard()).aiCallsToday, before.aiCallsToday + 1);
      await updateSettings({ emailDailyLimit: 999, whatsappDailyLimit: 999 });
    });
    await t.test("CSV excludes live Google fields and neutralizes formulas", async () => {
      const csv = await exportCompaniesCsv();
      assert.ok(csv.includes("google:test-place-id")); assert.ok(!csv.includes(companyName));
      assert.ok(!csv.includes("synthetic.example")); assert.ok(csv.includes("'=Synthetic CRM test"));
      assert.ok((await exportOutreachCsv()).includes("Marked sent at (self-reported)"));
    });
    await t.test("demo controls are explicit, repeatable, fully isolated and do not call APIs", async () => {
      globalThis.fetch = async () => { throw new Error("Demo must not call external APIs"); };
      const before = await getDashboard();
      await loadDemoData(); await loadDemoData();
      assert.equal((await getDashboard()).totals.companies, before.totals.companies);
      assert.ok((await listCompanies({ showAll: true })).every(c => c.source !== "demo"));
      assert.ok(!(await exportCompaniesCsv()).includes("sample-kl-"));
      assert.ok(!(await exportOutreachCsv()).includes("Fictional sample draft"));
      await withDataMode(true, async () => {
        assert.equal((await listCompanies({ showAll: true })).length, 30);
        assert.equal(await getCompany(manualId), null);
        const demo = (await listCompanies({ showAll: true }))[0]!;
        await saveWebsiteCheck(demo.id, baseCheck);
        assert.ok((await listActivity()).length > 0);
        assert.ok((await exportCompaniesCsv()).includes("sample-kl-"));
        await recordGooglePlacesRequest("Synthetic demo usage", "Demo");
        await deleteSampleData();
        assert.equal((await getDashboard()).totals.companies, 0);
        assert.equal((await getDashboard()).googlePlacesRequestsCount, 0);
      });
      assert.equal((await getDashboard()).totals.companies, before.totals.companies);
      assert.equal((await getDashboard()).googlePlacesRequestsCount, before.googlePlacesRequestsCount);
      assert.ok(await getCompany(manualId));
    });
    await t.test("invalid AI output falls back; 429 starts cooldown (mocked)", async () => {
      process.env.GEMINI_API_KEY = "test-only-placeholder";
      globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ subject: "Wrong", emailBody: "guaranteed", whatsappBody: "Missing finding" }) }] } }] });
      const invalid = await generateDraft(record.id, companyName);
      assert.ok(!("error" in invalid) && invalid.draftMode === "template");
      let calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json({}, { status: 429, headers: { "retry-after": "60" } }); };
      const input = { companyName, area: "Test", keyword: "dental", finding: "A real finding.", aiInstruction: "", senderName: "Test", senderTitle: "Designer", portfolioUrl: "https://example.com", whatsappNumber: "test" };
      await assert.rejects(generateOutreachDraft(input), GeminiQuotaError);
      await assert.rejects(generateOutreachDraft(input), GeminiQuotaError);
      assert.equal(calls, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await pool.end();
  }
});
