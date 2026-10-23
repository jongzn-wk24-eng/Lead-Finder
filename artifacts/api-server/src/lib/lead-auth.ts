import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "kl_lead_session";
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function secureHash(value: string) {
  return createHash("sha256").update(value).digest();
}

function validPassword(candidate: string, expected: string) {
  return timingSafeEqual(secureHash(candidate), secureHash(expected));
}

function signature(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function isAuthenticated(req: Request) {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token !== "string" || !process.env.SESSION_SECRET) return false;
  const [payload, providedSignature] = token.split(".");
  if (!payload || !providedSignature) return false;
  const expectedSignature = signature(payload);
  if (!expectedSignature) return false;
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      issuedAt: number;
      nonce: string;
    };
    const age = Date.now() - session.issuedAt;
    return Number.isFinite(age) && age >= 0 && age < SESSION_MAX_AGE_MS && Boolean(session.nonce);
  } catch {
    return false;
  }
}

export function authState(req: Request) {
  return {
    configured: Boolean(process.env.APP_PASSWORD && process.env.SESSION_SECRET),
    authenticated: isAuthenticated(req),
  };
}

export function login(req: Request, res: Response, password: string) {
  const configuredPassword = process.env.APP_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!configuredPassword || !sessionSecret) {
    return { status: 503, error: "Password protection is not configured." };
  }

  const key = req.ip || "unknown";
  const now = Date.now();
  const current = attempts.get(key);
  if (current && current.resetAt > now && current.count >= 8) {
    return { status: 429, error: "Too many attempts. Wait 15 minutes and try again." };
  }
  if (!validPassword(password, configuredPassword)) {
    const entry =
      current && current.resetAt > now
        ? { count: current.count + 1, resetAt: current.resetAt }
        : { count: 1, resetAt: now + 15 * 60 * 1000 };
    attempts.set(key, entry);
    return { status: 401, error: "Incorrect password." };
  }

  attempts.delete(key);
  const payload = Buffer.from(
    JSON.stringify({ issuedAt: now, nonce: randomBytes(18).toString("base64url") }),
  ).toString("base64url");
  const signed = `${payload}.${createHmac("sha256", sessionSecret).update(payload).digest("base64url")}`;
  res.cookie(COOKIE_NAME, signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS,
  });
  return { status: 200 };
}

export function logout(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

export function requireLeadAuth(req: Request, res: Response, next: NextFunction) {
  const state = authState(req);
  if (!state.configured) {
    res.status(503).json({ error: "Password protection is not configured." });
    return;
  }
  if (!state.authenticated) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }
  next();
}

