import { lookup as dnsLookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { chromium, type Browser } from "playwright-core";
import {
  getCompany,
  getLatestDesignScreenshotPaths,
  saveWebsiteCheck,
  updateLatestDesignResult,
  type WebsiteCheckInput,
} from "./lead-db";
import { GeminiQuotaError, scoreWebsiteDesign } from "./gemini-ai";
import { logger } from "./logger";
import { storeWebsiteScreenshot } from "./screenshot-storage";

const PAGE_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const currentYear = new Date().getFullYear();
const SOCIAL_SITE = /(?:^|\.)facebook\.com$|(?:^|\.)instagram\.com$/i;
const USER_AGENT = "KLLeadFinderWebsiteCheck/2.0 (homepage-only research)";

type ResolvedPublicAddress = { address: string; family: number };
type SafeHtml = { url: string; status: number; headers: IncomingHttpHeaders; html: string };
type PageSignals = {
  emails: string[];
  whatsapp: string | null;
  hasTelLink: boolean;
  hasWhatsappLink: boolean;
  hasForm: boolean;
  siteBuilder: string | null;
  copyrightYear: number | null;
  hasViewport: boolean;
  contactUrl: string | null;
};

function blockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function blockedAddress(address: string, family: number) {
  const normalized = address.toLowerCase().split("%")[0]!;
  if (family === 4) return blockedIpv4(normalized);
  if (family !== 6) return true;
  if (normalized.startsWith("::ffff:")) {
    const ipv4 = normalized.slice(7);
    if (isIP(ipv4) === 4) return blockedIpv4(ipv4);
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

async function resolvePublicAddress(hostname: string): Promise<ResolvedPublicAddress> {
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || isIP(hostname)) {
    throw new Error("Private or literal website addresses are not allowed.");
  }
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => blockedAddress(item.address, item.family))) {
    throw new Error("The website resolves to a private or reserved address.");
  }
  return addresses[0]!;
}

function makePinnedLookup(address: ResolvedPublicAddress): NonNullable<RequestOptions["lookup"]> {
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

async function safeGetHtml(rawUrl: string, redirects = 0): Promise<SafeHtml> {
  if (redirects > 3) throw new Error("The site redirected too many times.");
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("The website URL is invalid.");
  }
  const address = await resolvePublicAddress(url.hostname);
  const options: RequestOptions = {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      "Accept-Encoding": "identity",
    },
    lookup: makePinnedLookup(address),
    timeout: PAGE_TIMEOUT_MS,
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requester(url, options, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        safeGetHtml(new URL(location, url).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 400) {
        response.resume();
        finishError(new Error(`Website returned HTTP ${status || "unknown"}.`));
        return;
      }
      const chunks: Buffer[] = [];
      let byteCount = 0;
      response.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteCount += bytes.length;
        if (byteCount > MAX_HTML_BYTES) {
          response.destroy();
          finishError(new Error("Homepage HTML exceeded the 2 MB check limit."));
          return;
        }
        chunks.push(bytes);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          url: url.toString(),
          status,
          headers: response.headers,
          html: Buffer.concat(chunks).toString("utf8"),
        });
      });
      response.on("error", finishError);
    });
    request.setTimeout(PAGE_TIMEOUT_MS, () => request.destroy(new Error("Website check timed out.")));
    request.on("error", finishError);
    request.end();
  });
}

function decodeBasicEntities(value: string) {
  return value.replaceAll("&amp;", "&").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

function extractSignals(html: string, baseUrl: string): PageSignals {
  const mailtoEmails = [...html.matchAll(/href\s*=\s*["']mailto:([^"'?#\s]+)/gi)].map((match) => decodeBasicEntities(match[1]!).trim());
  const visibleEmails = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const emails = [...new Set([...mailtoEmails, ...visibleEmails].map((item) => item.toLowerCase()).filter((item) => item.length < 255))].slice(0, 10);
  const whatsappMatch =
    html.match(/https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^"'<> \t\r\n]+/i)?.[0] ??
    html.match(/href\s*=\s*["'](?:whatsapp|https?:\/\/[^"']*whatsapp[^"']*)["']/i)?.[0]?.replace(/^href\s*=\s*["']|["']$/g, "");
  let whatsapp: string | null = null;
  if (whatsappMatch) {
    const link = decodeBasicEntities(whatsappMatch.replace(/^href\s*=\s*["']/i, "").replace(/["']$/, ""));
    try {
      const url = new URL(link.startsWith("whatsapp:") ? `https://wa.me/${link.split(":").slice(1).join(":")}` : link);
      const path = url.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
      whatsapp = path.replace(/[^\d+]/g, "") || url.toString();
    } catch {
      whatsapp = link;
    }
  }
  const contactLink = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)]
    .map((match) => ({ href: decodeBasicEntities(match[1]!), text: match[2]!.replace(/<[^>]*>/g, " ").toLowerCase() }))
    .find(({ href, text }) => /contact|enquir|reach-us|get-in-touch/i.test(`${href} ${text}`));
  let contactUrl: string | null = null;
  if (contactLink) {
    try {
      const candidate = new URL(contactLink.href, baseUrl);
      if (candidate.origin === new URL(baseUrl).origin && ["http:", "https:"].includes(candidate.protocol)) {
        contactUrl = candidate.toString();
      }
    } catch {
      contactUrl = null;
    }
  }
  const copyright = [...html.matchAll(/(?:©|\(c\)|copyright)[^<]{0,100}?(20\d{2})/gi)]
    .map((match) => Number(match[1]))
    .filter((year) => year >= 1990 && year <= currentYear + 1);
  let siteBuilder: string | null = null;
  if (/wp-content|wp-includes|wordpress/i.test(html)) siteBuilder = "WordPress";
  else if (/wixstatic|wix\.com|wixsite/i.test(html)) siteBuilder = "Wix";
  else if (/squarespace/i.test(html)) siteBuilder = "Squarespace";
  else if (/webflow/i.test(html)) siteBuilder = "Webflow";
  else if (/shopify/i.test(html)) siteBuilder = "Shopify";
  return {
    emails,
    whatsapp,
    hasTelLink: /href\s*=\s*["']tel:/i.test(html),
    hasWhatsappLink: /(?:wa\.me\/|api\.whatsapp\.com|whatsapp:\/\/)/i.test(html),
    hasForm: /<form\b/i.test(html),
    siteBuilder,
    copyrightYear: copyright.length ? Math.max(...copyright) : null,
    hasViewport: /<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html),
    contactUrl,
  };
}

async function readContactPage(url: string | null): Promise<SafeHtml | null> {
  if (!url) return null;
  try {
    return await safeGetHtml(url);
  } catch {
    return null;
  }
}

async function getPageSpeed(url: string) {
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", "mobile");
  endpoint.searchParams.set("category", "performance");
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`PageSpeed Insights returned HTTP ${response.status}.`);
  const data = await response.json() as {
    lighthouseResult?: {
      categories?: { performance?: { score?: number | null } };
      audits?: { "largest-contentful-paint"?: { numericValue?: number } };
    };
  };
  const score = data.lighthouseResult?.categories?.performance?.score;
  const lcpMs = data.lighthouseResult?.audits?.["largest-contentful-paint"]?.numericValue;
  return {
    score: typeof score === "number" ? Math.round(score * 100) : null,
    lcpSeconds: typeof lcpMs === "number" ? Math.round((lcpMs / 1000) * 10) / 10 : null,
  };
}

let browserPromise: Promise<Browser> | null = null;
async function getBrowser() {
  if (!browserPromise) {
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      (existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined);
    browserPromise = chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      timeout: 15_000,
    }).catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

async function captureScreenshot(companyId: number, url: string, variant: "desktop" | "mobile") {
  const browser = await getBrowser();
  const viewport = variant === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 };
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  try {
    await page.route("**/*", async (route) => {
      const target = route.request().url();
      if (!target.startsWith("http://") && !target.startsWith("https://")) {
        await route.abort();
        return;
      }
      try {
        await resolvePublicAddress(new URL(target).hostname);
        await route.continue();
      } catch {
        await route.abort();
      }
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    await page.waitForTimeout(350);
    const bytes = await page.screenshot({ type: "png", fullPage: false, animations: "disabled" });
    return await storeWebsiteScreenshot(companyId, variant, Buffer.from(bytes));
  } finally {
    await page.close();
  }
}

function isSocialPage(url: string) {
  try {
    return SOCIAL_SITE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function scoreWebsite(
  homepageUrl: string,
  signals: PageSignals,
  contactSignals: PageSignals | null,
  psi: { score: number | null; lcpSeconds: number | null },
) {
  let problemScore = 0;
  const reasons: string[] = [];
  if (psi.score !== null && psi.score < 90) {
    if (psi.score < 50) {
      problemScore += 15;
      reasons.push(`Mobile PageSpeed performance score is ${psi.score}/100.`);
    } else {
      problemScore += 7;
      reasons.push(`Mobile PageSpeed performance score is ${psi.score}/100.`);
    }
  }
  if (psi.lcpSeconds !== null && psi.lcpSeconds > 4) {
    problemScore += 5;
    reasons.push(`Largest contentful paint is ${psi.lcpSeconds} seconds on mobile.`);
  }
  problemScore = Math.min(problemScore, 20);
  let techScore = 0;
  if (signals.copyrightYear !== null && signals.copyrightYear <= currentYear - 5) {
    techScore += 10;
    reasons.push(`Homepage copyright year is ${signals.copyrightYear}.`);
  }
  const https = new URL(homepageUrl).protocol === "https:";
  if (!https) {
    techScore += 5;
    reasons.push("Homepage does not use HTTPS.");
  }
  if (!signals.hasViewport) {
    techScore += 5;
    reasons.push("Homepage has no mobile viewport declaration.");
  }
  problemScore += Math.min(techScore, 20);
  const hasTelLink = signals.hasTelLink || Boolean(contactSignals?.hasTelLink);
  const hasWhatsappLink = signals.hasWhatsappLink || Boolean(contactSignals?.hasWhatsappLink);
  const hasContactForm = signals.hasForm || Boolean(contactSignals?.hasForm);
  const hasContactPage = Boolean(signals.contactUrl);
  let contactScore = 0;
  if (!hasTelLink) {
    contactScore += 3;
    reasons.push("No click-to-call phone link was found.");
  }
  if (!hasWhatsappLink) {
    contactScore += 4;
    reasons.push("No WhatsApp link was found.");
  }
  if (!hasContactForm && !hasContactPage) {
    contactScore += 3;
    reasons.push("No contact form or contact page link was found.");
  }
  problemScore += Math.min(contactScore, 10);
  return {
    problemScore: Math.min(problemScore, 70),
    reasons: reasons.slice(0, 3),
    hasTelLink,
    hasWhatsappLink,
    hasContactForm,
    hasContactPage,
  };
}

function findingTypeFor(reasons: string[], https: boolean, copyrightYear: number | null, hasTelLink: boolean, hasWhatsappLink: boolean) {
  if (!hasTelLink || !hasWhatsappLink) return "no_contact_button";
  if (reasons.some((reason) => reason.includes("PageSpeed") || reason.includes("Largest contentful"))) return "slow_mobile";
  if (!https) return "not_secure";
  if (copyrightYear !== null && copyrightYear <= currentYear - 5) return "outdated";
  return null;
}

function socialOrWebsiteType(companyUrl: string | null) {
  if (!companyUrl) return "none" as const;
  return isSocialPage(companyUrl) ? "social" as const : "own" as const;
}

function problemForMissingWebsite(websiteType: "social" | "none"): WebsiteCheckInput {
  return {
    websiteType,
    psiMobileScore: null,
    lcpSeconds: null,
    https: null,
    hasViewport: null,
    copyrightYear: null,
    hasTelLink: null,
    hasWhatsappLink: null,
    hasContactForm: null,
    hasContactPage: null,
    siteBuilder: null,
    retryCount: 0,
    checkStatus: "skipped",
    lastError: null,
    screenshotDesktopPath: null,
    screenshotMobilePath: null,
    problemScore: 50,
    reasons: [websiteType === "social" ? "Only a social page was listed for this business." : "No website was listed for this business."],
    findingType: "no_website",
    email: null,
    whatsapp: null,
  };
}

async function runOneCheck(companyId: number, websiteUrl: string, retryCount: number): Promise<WebsiteCheckInput> {
  const homepage = await safeGetHtml(websiteUrl);
  const signals = extractSignals(homepage.html, homepage.url);
  const contactPage = await readContactPage(signals.contactUrl);
  const contactSignals = contactPage ? extractSignals(contactPage.html, contactPage.url) : null;
  let psi = { score: null as number | null, lcpSeconds: null as number | null };
  let psiError: string | null = null;
  let psiRetryCount = 0;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      psi = await getPageSpeed(homepage.url);
      psiError = null;
      break;
    } catch (error) {
      psiError = error instanceof Error ? error.message : "PageSpeed Insights check failed.";
      if (attempt === 0) {
        psiRetryCount = 1;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
  }

  let screenshotDesktopPath: string | null = null;
  let screenshotMobilePath: string | null = null;
  let screenshotError: string | null = null;
  try {
    screenshotDesktopPath = await captureScreenshot(companyId, homepage.url, "desktop");
    screenshotMobilePath = await captureScreenshot(companyId, homepage.url, "mobile");
  } catch (error) {
    screenshotError = error instanceof Error ? error.message : "Screenshot capture was unavailable.";
    logger.warn({ companyId, err: error }, "Website screenshots were unavailable");
  }

  const https = new URL(homepage.url).protocol === "https:";
  const computed = scoreWebsite(homepage.url, signals, contactSignals, psi);
  const reasons = [...computed.reasons];
  const score = computed.problemScore;
  if (screenshotError) logger.debug({ companyId }, "Screenshot capture was skipped; visual scoring is unavailable");
  return {
    websiteType: "own",
    psiMobileScore: psi.score,
    lcpSeconds: psi.lcpSeconds,
    https,
    hasViewport: signals.hasViewport,
    copyrightYear: signals.copyrightYear,
    hasTelLink: computed.hasTelLink,
    hasWhatsappLink: computed.hasWhatsappLink,
    hasContactForm: computed.hasContactForm,
    hasContactPage: computed.hasContactPage,
    siteBuilder: signals.siteBuilder ?? contactSignals?.siteBuilder ?? null,
    retryCount: Math.max(retryCount, psiRetryCount),
    checkStatus: psiError ? "failed" : "completed",
    lastError: psiError,
    screenshotDesktopPath,
    screenshotMobilePath,
    problemScore: score,
    reasons: reasons.slice(0, 3),
    findingType: findingTypeFor(reasons, https, signals.copyrightYear, computed.hasTelLink, computed.hasWhatsappLink),
    email: signals.emails[0] ?? contactSignals?.emails[0] ?? null,
    whatsapp: signals.whatsapp ?? contactSignals?.whatsapp ?? null,
  };
}

async function runWithRetry(companyId: number, websiteUrl: string): Promise<WebsiteCheckInput> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      return await runOneCheck(companyId, websiteUrl, attempt);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  const message = lastError instanceof Error ? lastError.message : "Website check failed after one retry.";
  return {
    websiteType: "down",
    psiMobileScore: null,
    lcpSeconds: null,
    https: null,
    hasViewport: null,
    copyrightYear: null,
    hasTelLink: null,
    hasWhatsappLink: null,
    hasContactForm: null,
    hasContactPage: null,
    siteBuilder: null,
    retryCount: 1,
    checkStatus: "failed",
    lastError: message,
    screenshotDesktopPath: null,
    screenshotMobilePath: null,
    problemScore: 30,
    reasons: ["The website did not load after one retry; check it manually."],
    findingType: "site_down",
    email: null,
    whatsapp: null,
  };
}

export async function checkCompanyWebsite(companyId: number): Promise<{ failed: boolean; error: string | null }> {
  const company = getCompany(companyId);
  if (!company) return { failed: true, error: "Company not found." };
  const websiteType = socialOrWebsiteType(company.websiteUrl);
  if (websiteType !== "own") {
    saveWebsiteCheck(companyId, problemForMissingWebsite(websiteType));
    return { failed: false, error: null };
  }
  const result = await runWithRetry(companyId, company.websiteUrl!);
  saveWebsiteCheck(companyId, result);
  const screenshots = getLatestDesignScreenshotPaths(companyId);
  if (screenshots) {
    if (!process.env.GEMINI_API_KEY) {
      updateLatestDesignResult({
        companyId,
        status: "pending",
        message: "Design score pending: add GEMINI_API_KEY in Replit Secrets.",
      });
    } else {
      try {
        const design = await scoreWebsiteDesign(screenshots.desktopPath, screenshots.mobilePath);
        updateLatestDesignResult({
          companyId,
          status: "completed",
          score: design.score,
          ctaObvious: design.ctaObvious,
          reasons: design.reasons,
        });
      } catch (error) {
        const isQuota = error instanceof GeminiQuotaError;
        updateLatestDesignResult({
          companyId,
          status: isQuota ? "pending" : "failed",
          message: isQuota
            ? "Design score pending: Gemini free-tier quota was reached."
            : error instanceof Error
              ? error.message
              : "Gemini design scoring failed.",
        });
        logger.warn(
          { companyId, status: isQuota ? "pending" : "failed", err: error },
          "Gemini design scoring did not complete",
        );
      }
    }
  }
  return { failed: result.checkStatus === "failed", error: result.lastError };
}

export function isScreenshotPathAllowed(path: string) {
  return path.startsWith("/") && !path.includes("..");
}
