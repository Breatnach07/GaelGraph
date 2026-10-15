PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    picture_url TEXT,
    region_type TEXT CHECK (region_type IN ('ireland', 'international')),
    region_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS questions (
    question_id TEXT PRIMARY KEY,
    image_url TEXT NOT NULL,
    options_json TEXT NOT NULL CHECK (
        json_valid(options_json) AND json_array_length(options_json) = 4
    ),
    correct_index INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
    close_index INTEGER NOT NULL CHECK (close_index BETWEEN 0 AND 3),
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    CHECK (correct_index != close_index)
);

CREATE TABLE IF NOT EXISTS daily_questions (
    game_date TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9),
    question_id TEXT NOT NULL REFERENCES questions(question_id),
    PRIMARY KEY (game_date, position),
    UNIQUE (game_date, question_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_questions_date ON daily_questions(game_date);
CREATE INDEX IF NOT EXISTS idx_questions_active ON questions(active);

CREATE TABLE IF NOT EXISTS game_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES profiles(user_id),
    game_date TEXT NOT NULL,
    question_ids_json TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    submitted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_user_date
    ON game_sessions(user_id, game_date);

CREATE TABLE IF NOT EXISTS scores (
    user_id TEXT NOT NULL REFERENCES profiles(user_id),
    game_date TEXT NOT NULL,
    points INTEGER NOT NULL CHECK (points >= 0),
    correct_count INTEGER NOT NULL CHECK (correct_count BETWEEN 0 AND 10),
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, game_date)
);

CREATE INDEX IF NOT EXISTS idx_scores_date ON scores(game_date);
CREATE INDEX IF NOT EXISTS idx_scores_completed ON scores(completed_at);

CREATE TABLE IF NOT EXISTS friend_requests (
    request_id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES profiles(user_id),
    recipient_id TEXT NOT NULL REFERENCES profiles(user_id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (sender_id, recipient_id),
    CHECK (sender_id != recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient
    ON friend_requests(recipient_id, status);
