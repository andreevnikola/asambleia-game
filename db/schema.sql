-- Idempotent schema. Applied with `pnpm db:migrate`. Statements are separated by ";" at end of line.

CREATE TABLE IF NOT EXISTS game (
  id               int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status           text NOT NULL DEFAULT 'prep' CHECK (status IN ('prep','live','finished')),
  stage            text NOT NULL DEFAULT 'lobby' CHECK (stage IN ('lobby','picking','results','presenting','finished')),
  q_index          int NOT NULL DEFAULT 0,
  timer_started_at timestamptz,
  speak_seconds    int NOT NULL DEFAULT 180,
  pause_seconds    int NOT NULL DEFAULT 7,
  reveal_seconds   int NOT NULL DEFAULT 1,
  scroll_seconds   int NOT NULL DEFAULT 3,
  is_simulation    boolean NOT NULL DEFAULT false,
  user_seq         int NOT NULL DEFAULT 0,
  game_id          int NOT NULL DEFAULT 0,
  ver              int NOT NULL DEFAULT 0
);

INSERT INTO game (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS teams (
  id   serial PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id   serial PRIMARY KEY,
  text text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id         serial PRIMARY KEY,
  code       int NOT NULL UNIQUE CHECK (code BETWEEN 100 AND 999),
  name       text NOT NULL,
  team_id    int NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  ver        int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_team_idx ON users(team_id);

CREATE TABLE IF NOT EXISTS assignments (
  id          serial PRIMARY KEY,
  question_id int NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  team_id     int NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  user_id     int NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  slot        int NOT NULL,
  revealed_at timestamptz
);
