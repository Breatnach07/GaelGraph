const DIFFICULTY_QUOTAS = { easy: 3, medium: 3, hard: 4 };

export async function ensureDailyQuestions(db, gameDate) {
  const { results: existing } = await db.prepare(
    "SELECT question_id FROM daily_questions WHERE game_date = ?",
  ).bind(gameDate).all();
  if (existing.length === 10) return;

  const [prior, candidates] = await db.batch([
    db.prepare(
      `SELECT DISTINCT question_id FROM daily_questions
       WHERE game_date >= date(?, '-7 days') AND game_date < ?`,
    ).bind(gameDate, gameDate),
    db.prepare("SELECT question_id, difficulty FROM questions WHERE active = 1"),
  ]);
  const excluded = new Set(prior.results.map((row) => row.question_id));
  const selected = [];

  for (const [difficulty, count] of Object.entries(DIFFICULTY_QUOTAS)) {
    const eligible = candidates.results.filter((row) =>
      row.difficulty === difficulty && !excluded.has(row.question_id));
    if (eligible.length < count) {
      throw new Error(
        `Daily question pool has only ${eligible.length} eligible ${difficulty} questions.`,
      );
    }
    shuffle(eligible);
    selected.push(...eligible.slice(0, count));
  }

  await db.batch([
    db.prepare("DELETE FROM daily_questions WHERE game_date = ?").bind(gameDate),
    ...selected.map((row, position) => db.prepare(
      "INSERT INTO daily_questions (game_date, position, question_id) VALUES (?, ?, ?)",
    ).bind(gameDate, position, row.question_id)),
  ]);
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
}
