const COOKIE_NAME = "gaeilge_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

export async function createSessionToken(userId, secret) {
  const payload = base64url(JSON.stringify({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  }));
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySessionToken(token, secret) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  if (!constantTimeEqual(signature, await sign(payload, secret))) return null;
  try {
    const data = JSON.parse(decodeBase64url(payload));
    return data.exp > Math.floor(Date.now() / 1000) ? data.sub : null;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64url(String.fromCharCode(...new Uint8Array(signature)));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function base64url(value) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
}
