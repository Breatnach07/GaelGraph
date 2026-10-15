import { json, readJson } from "../lib/http.js";

export async function getFriends(db, user) {
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

export async function createFriendRequest(request, db, user) {
  const body = await readJson(request);
  const recipientId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!recipientId || recipientId === user.user_id) {
    return json({ error: "Enter another user's ID." }, 400);
  }

  const prior = await db.prepare(
    `SELECT r.request_id, r.sender_id, r.status, p.user_id AS recipient_user_id
     FROM profiles p
     LEFT JOIN friend_requests r
       ON (r.sender_id = ? AND r.recipient_id = p.user_id)
       OR (r.sender_id = p.user_id AND r.recipient_id = ?)
     WHERE p.user_id = ?`,
  ).bind(user.user_id, user.user_id, recipientId).first();
  if (!prior) return json({ error: "No account was found with that ID." }, 404);
  if (prior.status === "accepted") return json({ error: "You are already friends." }, 409);
  if (prior.status === "pending" && prior.sender_id === user.user_id) {
    return json({ error: "A request is already pending." }, 409);
  }
  if (prior.status === "pending") {
    await db.prepare(
      "UPDATE friend_requests SET status = 'accepted' WHERE request_id = ?",
    ).bind(prior.request_id).run();
    return json({ ok: true, accepted: true });
  }
  if (prior.status === "declined" && prior.sender_id === user.user_id) {
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

export async function updateFriendRequest(request, db, user, requestId) {
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
