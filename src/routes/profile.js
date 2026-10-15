import { json, readJson } from "../lib/http.js";
import { utcDate } from "../lib/date.js";

const COUNTY_LIST = [
  "Antrim", "Armagh", "Carlow", "Cavan", "Clare", "Cork", "Derry",
  "Donegal", "Down", "Dublin", "Fermanagh", "Galway", "Kerry", "Kildare",
  "Kilkenny", "Laois", "Leitrim", "Limerick", "Longford", "Louth", "Mayo",
  "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary",
  "Tyrone", "Waterford", "Westmeath", "Wexford", "Wicklow",
];
const REGIONS = [
  "Europe", "North America", "South America", "Asia", "Africa", "Middle East",
];

export async function getProfile(db, user) {
  const result = await db.prepare(
    `SELECT p.user_id, p.email, p.display_name, p.picture_url, p.region_type,
            p.region_name, s.points AS today_score, s.correct_count, s.completed_at
     FROM profiles p LEFT JOIN scores s
       ON s.user_id = p.user_id AND s.game_date = ?
     WHERE p.user_id = ?`,
  ).bind(utcDate(), user.user_id).first();
  if (!result) return json({ error: "Authentication required." }, 401);
  return json({ profile: result });
}

export async function updateRegion(request, db, user) {
  const body = await readJson(request);
  const valid = body.regionType === "ireland"
    ? COUNTY_LIST.includes(body.regionName)
    : body.regionType === "international" && REGIONS.includes(body.regionName);
  if (!valid) return json({ error: "Choose a valid region." }, 400);
  await db.prepare(
    "UPDATE profiles SET region_type = ?, region_name = ? WHERE user_id = ?",
  ).bind(body.regionType, body.regionName, user.user_id).run();
  return json({ regionType: body.regionType, regionName: body.regionName });
}
