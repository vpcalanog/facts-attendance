import crypto from "crypto";

// A minimal, dependency-free signed token (same idea as a JWT: base64url
// payload + HMAC signature). Set AUTH_SECRET in your environment — the
// fallback below is only for local dev and is NOT safe for production.
const SECRET = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64url(input) {
  return Buffer.from(input, "base64url").toString("utf-8");
}

export function signToken(payload) {
  const body = { ...payload, iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS };
  const encoded = base64url(JSON.stringify(body));
  const sig = crypto.createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;

  const [encoded, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(encoded).digest("base64url");

  const sigBuf = Buffer.from(sig || "");
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64url(encoded));
  } catch {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}
