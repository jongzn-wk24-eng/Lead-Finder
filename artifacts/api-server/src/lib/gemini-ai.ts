import { getPrivateScreenshot } from "./screenshot-storage";

export const MODEL = "gemini-3.6-flash";
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MIN_REQUEST_INTERVAL_MS = 5_000;

let lastRequestAt = 0;
let requestQueue: Promise<unknown> = Promise.resolve();
let quotaBlockedUntil = 0;

export class GeminiQuotaError extends Error {
  constructor(message = "Gemini free-tier quota is temporarily unavailable.") {
    super(message);
    this.name = "GeminiQuotaError";
  }
}

export class GeminiApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeminiApiError";
  }
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  const current = requestQueue.then(async () => {
    if (Date.now() < quotaBlockedUntil) throw new GeminiQuotaError();
    const delay = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (delay) await wait(delay);
    lastRequestAt = Date.now();
    return operation();
  });
  requestQueue = current.then(() => undefined, () => undefined);
  return current;
}

async function generateJson(parts: GeminiPart[], onRequest?: () => void | Promise<void>) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiApiError("Gemini is not configured. Add GEMINI_API_KEY in Replit Secrets.");
  return withRateLimit(async () => {
    await onRequest?.();
    const response = await fetch(GENERATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (response.status === 429) {
      const retrySeconds = Number(response.headers.get("retry-after"));
      quotaBlockedUntil = Date.now() + Math.max(60, Number.isFinite(retrySeconds) ? retrySeconds : 60) * 1_000;
      throw new GeminiQuotaError();
    }
    if (!response.ok) {
      let message = `Gemini returned HTTP ${response.status}.`;
      try {
        const payload = await response.json() as GeminiResponse;
        if (payload.error?.message) message = `Gemini: ${payload.error.message}`;
      } catch {
        // Keep the status-only message if the error body is not JSON.
      }
      throw new GeminiApiError(message.slice(0, 350), response.status);
    }
    const payload = await response.json() as GeminiResponse;
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!text) throw new GeminiApiError("Gemini returned an empty response.");
    return parseJson(text);
  });
}

function parseJson(text: string): Record<string, unknown> {
  const normalized = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const parsed: unknown = JSON.parse(normalized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new GeminiApiError("Gemini returned an unreadable JSON response.");
  }
}

export type DesignAnalysis = {
  score: number;
  ctaObvious: boolean;
  reasons: string[];
};

export async function scoreWebsiteDesign(desktopPath: string, mobilePath: string, onRequest?: () => void | Promise<void>): Promise<DesignAnalysis> {
  const [desktopFile, mobileFile] = await Promise.all([
    getPrivateScreenshot(desktopPath),
    getPrivateScreenshot(mobilePath),
  ]);
  const [[desktopBytes], [mobileBytes]] = await Promise.all([
    desktopFile.download(),
    mobileFile.download(),
  ]);
  const prompt = `Assess the visual design opportunity of this local business website from the desktop and mobile screenshots. Return JSON only: {"score": integer 0-100, "ctaObvious": boolean, "reasons": string[]}. Score 0 means the visible design is clear and effective; 100 means severe, concrete design problems that a web designer could improve. Judge legibility, hierarchy, mobile fit, trust cues, and whether the main contact/action is obvious in the first viewport. Do not infer facts outside the screenshots. Reasons must be specific and concise, at most 3. ctaObvious is true only if a visitor can readily identify the main action in the first viewport.`;
  const result = await generateJson([
    { text: prompt },
    { inlineData: { mimeType: "image/png", data: desktopBytes.toString("base64") } },
    { inlineData: { mimeType: "image/png", data: mobileBytes.toString("base64") } },
  ], onRequest);
  const score = Number(result.score);
  if (!Number.isFinite(score) || !Number.isInteger(score) || score < 0 || score > 100) {
    throw new GeminiApiError("Gemini returned a design score outside the expected 0-100 range.");
  }
  if (typeof result.ctaObvious !== "boolean") {
    throw new GeminiApiError("Gemini did not return a valid CTA visibility result.");
  }
  const reasons = Array.isArray(result.reasons)
    ? result.reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0).slice(0, 3)
    : [];
  return { score, ctaObvious: result.ctaObvious, reasons };
}

export type DraftContent = {
  subject: string;
  emailBody: string;
  whatsappBody: string;
};

export async function generateOutreachDraft(input: {
  companyName: string;
  area: string;
  keyword: string;
  finding: string;
  aiInstruction: string;
  senderName: string;
  senderTitle: string;
  portfolioUrl: string;
  whatsappNumber: string;
}, onRequest?: () => void | Promise<void>): Promise<DraftContent> {
  const result = await generateJson([{
    text: `Follow this editable instruction exactly where it does not conflict with the strict output rules:
${input.aiInstruction}

Write one email and one WhatsApp draft using only these verified inputs:
Company: ${input.companyName}
Area: ${input.area}
Business category: ${input.keyword}
Exact verified finding to include: ${input.finding}
Sender: ${input.senderName}, ${input.senderTitle}
Portfolio: ${input.portfolioUrl}
WhatsApp: ${input.whatsappNumber}

Strict rules: both message bodies must contain the company name and include the exact finding sentence above; each body must be under 100 words; do not invent facts, imply a relationship, claim an unperformed call/visit, make guarantees or outcome claims, mention a price or percentage, use buzzwords, or use phrases such as "100%", "guaranteed", "I checked your site on my phone", or "I found you on Google Maps". Return JSON only with string fields subject, emailBody, whatsappBody.`,
  }], onRequest);
  const subject = typeof result.subject === "string" ? result.subject.trim() : "";
  const emailBody = typeof result.emailBody === "string" ? result.emailBody.trim() : "";
  const whatsappBody = typeof result.whatsappBody === "string" ? result.whatsappBody.trim() : "";
  if (!subject || !emailBody || !whatsappBody) {
    throw new GeminiApiError("Gemini did not return all required draft fields.");
  }
  return { subject, emailBody, whatsappBody };
}
