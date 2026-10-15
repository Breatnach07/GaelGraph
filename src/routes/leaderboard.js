import { json } from "../lib/http.js";
import { utcDate } from "../lib/date.js";

export async function getLeaderboard(url, db, user) {
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
  const bindings = scope === "local" ? [user.user_id, lowerDate] : [lowerDate];
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
