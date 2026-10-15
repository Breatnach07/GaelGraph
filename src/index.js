const COOKIE_NAME = "gaeilge_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;
const COUNTY_LIST = [
  "Antrim", "Armagh", "Carlow", "Cavan", "Clare", "Cork", "Derry",
  "Donegal", "Down", "Dublin", "Fermanagh", "Galway", "Kerry", "Kildare",
  "Kilkenny", "Laois", "Leitrim", "Limerick", "Longford", "Louth", "Mayo",
  "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary",
  "Tyrone", "Waterford", "Westmeath", "Wexford", "Wicklow",
];
const CONTINENTS = [
  "Europe", "North America", "South America", "Asia", "Africa", "Middle East",
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        console.error("API request failed", error);
        return json(
          { error: error.status === 400 ? error.message : "The request could not be completed." },
          error.status || 500,
        );
      }
    }
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    const isHtml = headers.get("Content-Type")?.includes("text/html");
    headers.set(
      "Cache-Control",
      asset.status >= 400
        ? "no-store"
        : isHtml
        ? "public, max-age=300, s-maxage=86400, stale-while-revalidate=3600"
        : "public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400",
    );
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(ensureDailyQuestions(env.DB, new Date().toISOString().slice(0, 10)));
  },
};

async function handleApi(request, env, url) {
  if (url.pathname === "/api/config" && request.method === "GET") {
    return json({ googleClientId: env.GOOGLE_CLIENT_ID || "" });
  }
  if (url.pathname === "/api/auth/google" && request.method === "POST") {
    return loginWithGoogle(request, env);
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" },
    });
  }

  const user = await authenticate(request, env);
  if (!user) return json({ error: "Authentication required." }, 401);

  if (url.pathname === "/api/me" && request.method === "GET") {
    const today = utcDate();
    const result = await env.DB.prepare(
      `SELECT p.user_id, p.email, p.display_name, p.picture_url, p.region_type,
              p.region_name, s.points AS today_score, s.correct_count, s.completed_at
       FROM profiles p LEFT JOIN scores s
         ON s.user_id = p.user_id AND s.game_date = ?
       WHERE p.user_id = ?`,
    ).bind(today, user.user_id).first();
    if (!result) return json({ error: "Authentication required." }, 401);
    return json({ profile: result });
  }

  if (url.pathname === "/api/profile/region" && request.method === "PUT") {
    const body = await readJson(request);
    const valid = body.regionType === "ireland"
      ? COUNTY_LIST.includes(body.regionName)
      : body.regionType === "international" && CONTINENTS.includes(body.regionName);
    if (!valid) return json({ error: "Choose a valid region." }, 400);
    await env.DB.prepare(
      "UPDATE profiles SET region_type = ?, region_name = ? WHERE user_id = ?",
    ).bind(body.regionType, body.regionName, user.user_id).run();
    return json({ regionType: body.regionType, regionName: body.regionName });
  }

  if (url.pathname === "/api/leaderboard" && request.method === "GET") {
    return getLeaderboard(url, env.DB, user);
  }
  if (url.pathname === "/api/game" && request.method === "GET") {
    return startGame(env.DB, user);
  }
  if (url.pathname === "/api/game/submit" && request.method === "POST") {
    return submitGame(request, env.DB, user);
  }
  if (url.pathname === "/api/friends" && request.method === "GET") {
    return getFriends(env.DB, user);
  }
  if (url.pathname === "/api/friends/request" && request.method === "POST") {
    return createFriendRequest(request, env.DB, user);
  }
  if (url.pathname.startsWith("/api/friends/") && request.method === "POST") {
    return updateFriendRequest(request, env.DB, user, url.pathname.split("/").pop());
  }
  return json({ error: "Not found." }, 404);
}

async function loginWithGoogle(request, env) {
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

async function authenticate(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!token || !env.SESSION_SECRET) return null;
  const userId = await verifySessionToken(token, env.SESSION_SECRET);
  if (!userId) return null;
  return { user_id: userId };
}

async function createSessionToken(userId, secret) {
  const payload = base64url(JSON.stringify({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  }));
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

async function verifySessionToken(token, secret) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = await sign(payload, secret);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const data = JSON.parse(decodeBase64url(payload));
    return data.exp > Math.floor(Date.now() / 1000) ? data.sub : null;
  } catch {
    return null;
  }
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
  for (let i = 0; i < left.length; i += 1) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
}

function base64url(value) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
}

async function ensureDailyQuestions(db, gameDate) {
  const existing = await db.prepare(
    "SELECT COUNT(*) AS count FROM daily_questions WHERE game_date = ?",
  ).bind(gameDate).first();
  if (existing.count === 10) return;

  const prior = await db.prepare(
    `SELECT DISTINCT question_id FROM daily_questions
     WHERE game_date >= date(?, '-7 days') AND game_date < ?`,
  ).bind(gameDate, gameDate).all();
  const excluded = new Set(prior.results.map((row) => row.question_id));
  const candidates = await db.prepare(
    "SELECT question_id, difficulty FROM questions WHERE active = 1",
  ).all();
  const quotas = { easy: 3, medium: 3, hard: 4 };
  const selected = [];
  for (const [difficulty, count] of Object.entries(quotas)) {
    const eligible = candidates.results.filter((row) =>
      row.difficulty === difficulty && !excluded.has(row.question_id));
    if (eligible.length < count) {
      throw new Error(
        `Daily question pool has only ${eligible.length} eligible ${difficulty} questions.`,
      );
    }
    for (let i = eligible.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    selected.push(...eligible.slice(0, count));
  }
  const shuffled = selected;
  const statements = [
    db.prepare("DELETE FROM daily_questions WHERE game_date = ?").bind(gameDate),
    ...shuffled.map((row, position) => db.prepare(
      "INSERT INTO daily_questions (game_date, position, question_id) VALUES (?, ?, ?)",
    ).bind(gameDate, position, row.question_id)),
  ];
  await db.batch(statements);
}

async function startGame(db, user) {
  const gameDate = utcDate();
  const played = await db.prepare(
    "SELECT points FROM scores WHERE user_id = ? AND game_date = ?",
  ).bind(user.user_id, gameDate).first();
  if (played) return json({ played: true, score: played.points });

  let daily = await db.prepare(
    `SELECT q.question_id, q.image_url, q.options_json, q.difficulty
     FROM daily_questions d JOIN questions q ON q.question_id = d.question_id
     WHERE d.game_date = ? ORDER BY d.position`,
  ).bind(gameDate).all();
  if (daily.results.length !== 10) {
    await ensureDailyQuestions(db, gameDate);
    daily = await db.prepare(
      `SELECT q.question_id, q.image_url, q.options_json, q.difficulty
       FROM daily_questions d JOIN questions q ON q.question_id = d.question_id
       WHERE d.game_date = ? ORDER BY d.position`,
    ).bind(gameDate).all();
  }
  if (daily.results.length !== 10) {
    return json({ error: "Today's game is not ready yet." }, 503);
  }
  const sessionId = crypto.randomUUID();
  const issuedAt = Date.now();
  const questionIds = daily.results.map((row) => row.question_id);
  await db.prepare(
    `INSERT INTO game_sessions (session_id, user_id, game_date, question_ids_json, issued_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(sessionId, user.user_id, gameDate, JSON.stringify(questionIds), issuedAt).run();
  return json({
    played: false,
    sessionId,
    issuedAt,
    questions: daily.results.map((row) => ({
      id: row.question_id,
      image: row.image_url,
      options: JSON.parse(row.options_json),
      difficulty: row.difficulty,
    })),
  });
}

async function submitGame(request, db, user) {
  const body = await readJson(request);
  if (!body.sessionId || !Array.isArray(body.answers) || body.answers.length !== 10) {
    return json({ error: "The submitted game is incomplete." }, 400);
  }
  const session = await db.prepare(
    `SELECT session_id, game_date, question_ids_json, issued_at, submitted_at
     FROM game_sessions WHERE session_id = ? AND user_id = ?`,
  ).bind(body.sessionId, user.user_id).first();
  if (!session || session.submitted_at || session.game_date !== utcDate()) {
    return json({ error: "This game session is invalid or already submitted." }, 409);
  }
  const elapsedSeconds = (Date.now() - session.issued_at) / 1000;
  if (elapsedSeconds < 5 || elapsedSeconds > 60 * 60) {
    return json({ error: "The game session timing is invalid." }, 400);
  }

  const expectedIds = JSON.parse(session.question_ids_json);
  if (body.answers.some((answer) =>
    !answer || typeof answer.questionId !== "string" ||
    !Number.isInteger(answer.choice) || answer.choice < 0 || answer.choice > 3)) {
    return json({ error: "One or more submitted answers are invalid." }, 400);
  }
  const byId = new Map(body.answers.map((answer) => [answer.questionId, answer]));
  if (byId.size !== 10 || expectedIds.some((id) => !byId.has(id))) {
    return json({ error: "The submitted answers do not match this game." }, 400);
  }
  const placeholders = expectedIds.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT question_id, correct_index, close_index FROM questions
     WHERE question_id IN (${placeholders})`,
  ).bind(...expectedIds).all();
  const answerKey = new Map(rows.results.map((row) => [row.question_id, row]));
  if (answerKey.size !== 10) return json({ error: "The game answer key is unavailable." }, 500);

  let points = 0;
  let correctCount = 0;
  const answerResults = expectedIds.map((id) => {
    const submitted = byId.get(id);
    const question = answerKey.get(id);
    const validIndex = Number.isInteger(submitted.choice) && submitted.choice >= 0 &&
      submitted.choice <= 3;
    const exact = validIndex && submitted.choice === question.correct_index;
    const close = validIndex && submitted.choice === question.close_index;
    if (exact) correctCount += 1;
    const credit = exact ? 1 : close ? 0.5 : 0;
    points += Math.round(credit * speedMultiplier(elapsedSeconds) * 100);
    return { questionId: id, correct: exact, close };
  });

  const gameDate = session.game_date;
  const result = await db.batch([
    db.prepare(
      `UPDATE game_sessions SET submitted_at = ?
       WHERE session_id = ? AND submitted_at IS NULL`,
    ).bind(Date.now(), session.session_id),
    db.prepare(
      `INSERT INTO scores (user_id, game_date, points, correct_count)
       VALUES (?, ?, ?, ?)`,
    ).bind(user.user_id, gameDate, points, correctCount),
  ]);
  if (result[0].meta.changes !== 1) {
    return json({ error: "This game session has already been submitted." }, 409);
  }
  return json({ score: points, correctCount, answers: answerResults });
}

function speedMultiplier(seconds) {
  return Math.max(0.5, 1 - seconds / 240);
}

async function getLeaderboard(url, db, user) {
  const period = url.searchParams.get("period") || "daily";
  const scope = url.searchParams.get("scope") || "global";
  if (!["daily", "weekly"].includes(period) || !["global", "local"].includes(scope)) {
    return json({ error: "Invalid leaderboard filters." }, 400);
  }
  const lowerDate = period === "daily"
    ? utcDate()
    : new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const regionCte = scope === "local"
    ? "WITH local_region AS (SELECT region_type, region_name FROM profiles WHERE user_id = ?)"
    : "";
  const regionFilter = scope === "local"
    ? `AND p.region_type = (SELECT region_type FROM local_region)
       AND p.region_name = (SELECT region_name FROM local_region)`
    : "";
  const bindings = scope === "local"
    ? [user.user_id, lowerDate]
    : [lowerDate];
  const leaderboard = await db.prepare(
    `${regionCte}
     SELECT p.user_id, p.display_name, p.picture_url, p.region_name,
            SUM(s.points) AS points, SUM(s.correct_count) AS correct_count
     FROM scores s JOIN profiles p ON p.user_id = s.user_id
     WHERE s.game_date >= ? ${regionFilter}
     GROUP BY p.user_id
     ORDER BY points DESC, correct_count DESC, p.display_name ASC
     LIMIT 100`,
  ).bind(...bindings).all();
  return json({
    period,
    scope,
    entries: leaderboard.results.map((row, index) => ({ rank: index + 1, ...row })),
  });
}

async function getFriends(db, user) {
  const result = await db.prepare(
    `SELECT r.request_id, r.status, r.created_at,
            sender.user_id AS sender_id, sender.display_name AS sender_name,
            recipient.user_id AS recipient_id, recipient.display_name AS recipient_name
     FROM friend_requests r
     JOIN profiles sender ON sender.user_id = r.sender_id
     JOIN profiles recipient ON recipient.user_id = r.recipient_id
     WHERE r.sender_id = ? OR r.recipient_id = ?
     ORDER BY r.created_at DESC`,
  ).bind(user.user_id, user.user_id).all();
  const accepted = [];
  const incoming = [];
  const outgoing = [];
  for (const request of result.results) {
    if (request.status === "accepted") {
      accepted.push({
        userId: request.sender_id === user.user_id ? request.recipient_id : request.sender_id,
        name: request.sender_id === user.user_id ? request.recipient_name : request.sender_name,
      });
    } else if (request.status === "pending" && request.recipient_id === user.user_id) {
      incoming.push({ ...request, name: request.sender_name });
    } else if (request.status === "pending") {
      outgoing.push({ ...request, name: request.recipient_name });
    }
  }
  return json({ userId: user.user_id, friends: accepted, incoming, outgoing });
}

async function createFriendRequest(request, db, user) {
  const body = await readJson(request);
  const recipientId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!recipientId || recipientId === user.user_id) {
    return json({ error: "Enter another user's ID." }, 400);
  }
  const recipient = await db.prepare(
    "SELECT user_id FROM profiles WHERE user_id = ?",
  ).bind(recipientId).first();
  if (!recipient) return json({ error: "No account was found with that ID." }, 404);

  const prior = await db.prepare(
    `SELECT request_id, sender_id, status FROM friend_requests
     WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)`,
  ).bind(user.user_id, recipientId, recipientId, user.user_id).first();
  if (prior?.status === "accepted") return json({ error: "You are already friends." }, 409);
  if (prior?.status === "pending" && prior.sender_id === user.user_id) {
    return json({ error: "A request is already pending." }, 409);
  }
  if (prior?.status === "pending") {
    await db.prepare(
      "UPDATE friend_requests SET status = 'accepted' WHERE request_id = ?",
    ).bind(prior.request_id).run();
    return json({ ok: true, accepted: true });
  }
  if (prior?.status === "declined" && prior.sender_id === user.user_id) {
    await db.prepare(
      `UPDATE friend_requests SET status = 'pending', created_at = CURRENT_TIMESTAMP
       WHERE request_id = ?`,
    ).bind(prior.request_id).run();
  } else {
    await db.prepare(
      `INSERT INTO friend_requests (request_id, sender_id, recipient_id)
       VALUES (?, ?, ?)`,
    ).bind(crypto.randomUUID(), user.user_id, recipientId).run();
  }
  return json({ ok: true }, 201);
}

async function updateFriendRequest(request, db, user, requestId) {
  const body = await readJson(request);
  if (!["accept", "decline"].includes(body.action)) {
    return json({ error: "Choose accept or decline." }, 400);
  }
  const nextStatus = body.action === "accept" ? "accepted" : "declined";
  const result = await db.prepare(
    `UPDATE friend_requests SET status = ?
     WHERE request_id = ? AND recipient_id = ? AND status = 'pending'`,
  ).bind(nextStatus, requestId, user.user_id).run();
  if (result.meta.changes !== 1) return json({ error: "Request not found." }, 404);
  return json({ ok: true });
}

async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      const error = new Error("Expected a JSON object.");
      error.status = 400;
      throw error;
    }
    return body;
  } catch {
    const error = new Error("Invalid JSON request body.");
    error.status = 400;
    throw error;
  }
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function json(data, status = 200, headers = {}) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}
