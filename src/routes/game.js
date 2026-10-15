import { json, readJson } from "../lib/http.js";
import { utcDate } from "../lib/date.js";
import { ensureDailyQuestions } from "../services/daily-questions.js";

export async function startGame(db, user) {
  const gameDate = utcDate();
  const sessionId = crypto.randomUUID();
  const issuedAt = Date.now();
  const [played, daily, createdSession] = await createGameSession(
    db, user, gameDate, sessionId, issuedAt,
  );
  if (played.results.length) {
    return json({ played: true, score: played.results[0].points });
  }

  let questions = daily.results;
  if (questions.length !== 10) {
    await ensureDailyQuestions(db, gameDate);
    const refreshed = await createGameSession(db, user, gameDate, sessionId, issuedAt);
    if (refreshed[0].results.length) {
      return json({ played: true, score: refreshed[0].results[0].points });
    }
    questions = refreshed[1].results;
    if (questions.length !== 10 || refreshed[2].meta.changes !== 1) {
      return json({ error: "Today's game is not ready yet." }, 503);
    }
  }
  if (questions.length !== 10 || createdSession.meta.changes !== 1) {
    return json({ error: "Today's game is not ready yet." }, 503);
  }

  return json({
    played: false,
    sessionId,
    issuedAt,
    questions: questions.map((row) => ({
      id: row.question_id,
      image: row.image_url,
      options: JSON.parse(row.options_json),
      difficulty: row.difficulty,
    })),
  });
}

function createGameSession(db, user, gameDate, sessionId, issuedAt) {
  return db.batch([
    db.prepare(
      "SELECT points FROM scores WHERE user_id = ? AND game_date = ?",
    ).bind(user.user_id, gameDate),
    db.prepare(
      `SELECT q.question_id, q.image_url, q.options_json, q.difficulty
       FROM daily_questions d JOIN questions q ON q.question_id = d.question_id
       WHERE d.game_date = ? ORDER BY d.position`,
    ).bind(gameDate),
    db.prepare(
      `INSERT INTO game_sessions (session_id, user_id, game_date, question_ids_json, issued_at)
       SELECT ?, ?, ?, (
         SELECT json_group_array(question_id) FROM (
           SELECT question_id FROM daily_questions WHERE game_date = ? ORDER BY position
         )
       ), ?
       WHERE (SELECT COUNT(*) FROM daily_questions WHERE game_date = ?) = 10
         AND NOT EXISTS (
           SELECT 1 FROM scores WHERE user_id = ? AND game_date = ?
         )`,
    ).bind(
      sessionId, user.user_id, gameDate, gameDate, issuedAt, gameDate,
      user.user_id, gameDate,
    ),
  ]);
}

export async function submitGame(request, db, user) {
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
  if (answerKey.size !== 10) {
    return json({ error: "The game answer key is unavailable." }, 500);
  }

  let points = 0;
  let correctCount = 0;
  const answerResults = expectedIds.map((id) => {
    const submitted = byId.get(id);
    const question = answerKey.get(id);
    const exact = submitted.choice === question.correct_index;
    const close = submitted.choice === question.close_index;
    if (exact) correctCount += 1;
    points += Math.round((exact ? 1 : close ? 0.5 : 0) * speedMultiplier(elapsedSeconds) * 100);
    return { questionId: id, correct: exact, close };
  });

  const result = await db.batch([
    db.prepare(
      `UPDATE game_sessions SET submitted_at = ?
       WHERE session_id = ? AND submitted_at IS NULL`,
    ).bind(Date.now(), session.session_id),
    db.prepare(
      `INSERT INTO scores (user_id, game_date, points, correct_count)
       VALUES (?, ?, ?, ?)`,
    ).bind(user.user_id, session.game_date, points, correctCount),
  ]);
  if (result[0].meta.changes !== 1) {
    return json({ error: "This game session has already been submitted." }, 409);
  }
  return json({ score: points, correctCount, answers: answerResults });
}

function speedMultiplier(seconds) {
  return Math.max(0.5, 1 - seconds / 240);
}
