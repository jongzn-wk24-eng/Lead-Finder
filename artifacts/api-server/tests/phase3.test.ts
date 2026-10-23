import test from "node:test";
import assert from "node:assert/strict";
import {
  createCompany, exportCompaniesCsv, exportOutreachCsv, generateDraft, getCompany,
  getDashboard, leadDb, listFollowups, logReply, markMessageSent,
  saveWebsiteCheck, updateLatestDesignResult, updateSettings, upsertGooglePlace,
  type WebsiteCheckInput,
} from "../src/lib/lead-db";
import { withLiveGoogleData } from "../src/lib/live-google";
import { estimateGooglePlacesRequests, searchGooglePlacesText } from "../src/lib/google-places";
import { generateOutreachDraft, GeminiQuotaError } from "../src/lib/gemini-ai";

test("Phase 3 retention, scoring, outreach and reminders (isolated, no external calls)", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected external network request in test"); };
  const record = upsertGooglePlace({ placeId: "test-place-id", area: "Test area", keyword: "dental" });
  const companyName = "Retention Test Dental";
  const baseCheck: WebsiteCheckInput = {
    websiteType: "none", psiMobileScore: null, lcpSeconds: null, https: null,
    hasViewport: null, copyrightYear: null, hasTelLink: null, hasWhatsappLink: null,
    hasContactForm: null, hasContactPage: null, siteBuilder: null, retryCount: 0,
    checkStatus: "completed", lastError: null, screenshotDesktopPath: null,
    screenshotMobilePath: null, problemScore: 25, reasons: ["No website was listed."],
    findingType: "no_website", email: null, whatsapp: null,
  };
  updateSettings({ myName: "Test Sender", myWhatsapp: "+60100000000", portfolioUrl: "https://example.com", emailDailyLimit: 999, followup1Days: 4, followup2Days: 10 });
  try {
    await t.test("deduplicates Place IDs and estimates unique pairs", () => {
      assert.equal(upsertGooglePlace({ placeId: "test-place-id", area: "Test", keyword: "test" }).id, record.id);
      assert.equal(estimateGooglePlacesRequests(["A", "A"], ["X", "Y"]).requestsEstimated, 2);
      assert.throws(() => estimateGooglePlacesRequests(Array.from({ length: 61 }, (_, i) => `${i}`), ["x"]));
    });
    await t.test("Text Search and Details use correct explicit field masks", async () => {
      globalThis.fetch = async (url, init) => {
        const headers = new Headers(init?.headers);
        const mask = headers.get("X-Goog-FieldMask")!;
        assert.ok(!mask.includes("*"));
        if (String(url).includes("searchText")) {
          assert.ok(mask.includes("places.id"));
          assert.equal(JSON.parse(String(init?.body)).pageSize, 20);
          return Response.json({ places: [{ id: "test-place-id" }] });
        }
        assert.ok(mask.includes("displayName"));
        assert.ok(!mask.includes("places."));
        return Response.json({ id: "test-place-id", displayName: { text: companyName }, formattedAddress: "Synthetic address", nationalPhoneNumber: "Synthetic phone", websiteUri: "https://synthetic.example", rating: 4.6, userRatingCount: 250 });
      };
      await searchGooglePlacesText("dental", "Test", () => undefined);
      const live = await withLiveGoogleData(getCompany(record.id)!);
      assert.equal(live.name, companyName);
      assert.equal(live.valueScore, 25);
      const stored = getCompany(record.id)!;
      assert.notEqual(stored.name, companyName);
      assert.equal(stored.websiteUrl, null);
      assert.equal(stored.phone, null);
      assert.equal(stored.rating, 0);
      assert.equal(stored.valueScore, 0);
      assert.ok(getDashboard().googlePlacesRequestsCount >= 1);
    });
    await t.test("website/design results save with 20-point weighted contribution", () => {
      saveWebsiteCheck(record.id, baseCheck);
      updateLatestDesignResult({ companyId: record.id, status: "completed", score: 90, ctaObvious: false, reasons: ["The action is hard to see."] });
      assert.equal(getCompany(record.id)!.problemScore, 43);
      const check = leadDb.prepare("SELECT design_status, cta_obvious FROM checks WHERE company_id = ? ORDER BY id DESC LIMIT 1").get(record.id)!;
      assert.equal(check.design_status, "completed");
      assert.equal(check.cta_obvious, 0);
      updateLatestDesignResult({ companyId: record.id, status: "pending", message: "Quota exhausted" });
      assert.equal(getCompany(record.id)!.problemScore, 25);
    });
    await t.test("unavailable Gemini falls back to short fact-based templates", async () => {
      const draft = await generateDraft(record.id, companyName);
      assert.ok(!("error" in draft));
      if ("error" in draft) return;
      assert.equal(draft.draftMode, "template");
      for (const body of [draft.emailBody, draft.whatsappBody]) {
        assert.ok(body.includes(companyName));
        assert.ok(body.includes(draft.finding));
        assert.ok(body.trim().split(/\s+/).length < 100);
      }
    });
    await t.test("follow-up dates follow settings and reply stats update", () => {
      const manual = createCompany({ name: "=Synthetic CRM test", area: "Test", keyword: "dental", findingType: "A verified manual observation." })!;
      const sent = markMessageSent(manual.id, { channel: "email", sequenceNo: 1, body: "User-authored synthetic message" });
      assert.ok(sent && !("error" in sent));
      const reminder = listFollowups().find((row) => Number(row.companyId) === manual.id)!;
      assert.ok(reminder);
      const due = new Date(String(reminder.dueAt)).getTime();
      assert.ok(Math.abs(due - Date.now() - 4 * 86400_000) < 10_000);
      const snapshot = leadDb.prepare("SELECT finding_type_at_send FROM outreach WHERE company_id = ?").get(manual.id)!;
      assert.equal(snapshot.finding_type_at_send, "manual");
      leadDb.prepare("UPDATE companies SET finding_type = 'site_down' WHERE id = ?").run(manual.id);
      const before = getDashboard().replyRatesByChannel.find((row) => row.channel === "email")!.replied;
      logReply(manual.id, "Synthetic reply");
      assert.equal(getDashboard().replyRatesByChannel.find((row) => row.channel === "email")!.replied, before + 1);
      assert.ok(getDashboard().replyRatesByFindingType.some((row) => row.findingType === "manual" && row.replied >= 1));
    });
    await t.test("CSV excludes live Google fields and neutralizes formula cells", () => {
      const csv = exportCompaniesCsv();
      assert.ok(csv.includes("google:test-place-id"));
      assert.ok(!csv.includes(companyName));
      assert.ok(!csv.includes("synthetic.example"));
      assert.ok(csv.includes("'=Synthetic CRM test"));
      assert.ok(exportOutreachCsv().includes("Place ID"));
    });
    await t.test("invalid AI output falls back and 429 starts a cooldown", async () => {
      process.env.GEMINI_API_KEY = "test-only-placeholder";
      globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ subject: "Wrong", emailBody: "guaranteed", whatsappBody: "Missing finding" }) }] } }] });
      const invalid = await generateDraft(record.id, companyName);
      assert.ok(!("error" in invalid) && invalid.draftMode === "template");
      let calls = 0;
      globalThis.fetch = async () => { calls += 1; return Response.json({}, { status: 429, headers: { "retry-after": "60" } }); };
      const input = { companyName, area: "Test", keyword: "dental", finding: "A real finding.", aiInstruction: "", senderName: "Test", senderTitle: "Designer", portfolioUrl: "https://example.com", whatsappNumber: "test" };
      await assert.rejects(generateOutreachDraft(input), GeminiQuotaError);
      await assert.rejects(generateOutreachDraft(input), GeminiQuotaError);
      assert.equal(calls, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    leadDb.close();
  }
});
