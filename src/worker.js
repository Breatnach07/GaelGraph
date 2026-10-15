import { handleApi } from "./routes/api.js";
import { ensureDailyQuestions } from "./services/daily-questions.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();

    if (
      pathname === "/comingsoon" ||
      pathname === "/comingsoon/" ||
      pathname === "/comingsoon/index.html"
    ) {
      return serveAsset(new Request(new URL("/ComingSoon/", url), request), env);
    }

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

    if (!url.pathname.startsWith("/assets/")) {
      return Response.redirect(new URL("/ComingSoon", url), 302);
    }
    return serveAsset(request, env);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(ensureDailyQuestions(env.DB, new Date().toISOString().slice(0, 10)));
  },
};

async function serveAsset(request, env) {
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
