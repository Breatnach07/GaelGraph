import { json, readJson } from "../lib/http.js";
import { createSessionToken, sessionCookie, verifySessionToken } from "../lib/session.js";

export async function loginWithGoogle(request, env) {
  const body = await readJson(request);
  if (!body.credential || !env.GOOGLE_CLIENT_ID ||
      env.GOOGLE_CLIENT_ID.startsWith("REPLACE_")) {
    return json({ error: "Google sign-in is not configured." }, 503);
  }

  const verification = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(body.credential)}`,
  );
  if (!verification.ok) return json({ error: "Google sign-in could not be verified." }, 401);
  const identity = await verification.json();
  if (identity.aud !== env.GOOGLE_CLIENT_ID || identity.email_verified !== "true" ||
      !identity.sub || !identity.email) {
    return json({ error: "Google sign-in could not be verified." }, 401);
  }

  let profile = await env.DB.prepare(
    "SELECT user_id FROM profiles WHERE google_sub = ?",
  ).bind(identity.sub).first();
  if (!profile) {
    profile = { user_id: crypto.randomUUID() };
    await env.DB.prepare(
      `INSERT INTO profiles (user_id, google_sub, email, display_name, picture_url)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      profile.user_id,
      identity.sub,
      identity.email,
      identity.name || identity.email.split("@")[0],
      identity.picture || null,
    ).run();
  } else {
    await env.DB.prepare(
      "UPDATE profiles SET email = ?, display_name = ?, picture_url = ? WHERE user_id = ?",
    ).bind(
      identity.email,
      identity.name || identity.email.split("@")[0],
      identity.picture || null,
      profile.user_id,
    ).run();
  }

  const token = await createSessionToken(profile.user_id, env.SESSION_SECRET);
  return json(
    { ok: true },
    200,
    { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" },
  );
}

export async function authenticate(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("gaeilge_session="))
    ?.slice("gaeilge_session=".length);
  if (!token || !env.SESSION_SECRET) return null;
  const userId = await verifySessionToken(token, env.SESSION_SECRET);
  return userId ? { user_id: userId } : null;
}
