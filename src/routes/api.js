import { authenticate, loginWithGoogle } from "./auth.js";
import { getFriends, createFriendRequest, updateFriendRequest } from "./friends.js";
import { getLeaderboard } from "./leaderboard.js";
import { getProfile, updateRegion } from "./profile.js";
import { startGame, submitGame } from "./game.js";
import { clearSessionCookie } from "../lib/session.js";
import { json } from "../lib/http.js";

export async function handleApi(request, env, url) {
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
    return getProfile(env.DB, user);
  }
  if (url.pathname === "/api/profile/region" && request.method === "PUT") {
    return updateRegion(request, env.DB, user);
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
