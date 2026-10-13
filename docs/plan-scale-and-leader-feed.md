# Plan: free-tier load diet, split "Assign / Choose leaders", leader live feed

Status: **implemented 2026-10-13** (see section 5 for what differs from the proposal). Scouted against `main` (98066c3); limits checked in the Vercel and Neon docs the same day.

## 0. Facts the plan rests on

| Fact | Where verified |
| --- | --- |
| DB access is the Neon **HTTP** driver (`neon()`), pooled URL, one stateless HTTPS call per query/transaction. No TCP pool in the app. | `lib/db.ts` |
| The "SSE" is **server-side polling of Neon every 2 s per client**, pushed down a long response. Not true push, so it is no faster than a client polling every 2-3 s. | `app/api/stream/route.ts` |
| Stream closes itself at 50 s (`maxDuration = 60`); `EventSource` reconnects (`retry: 500`) and gets a full snapshot. The 5-minute Vercel cut never fires today. | same + `PlayerApp.tsx` |
| Hobby + Fluid compute: max duration **300 s**. Included: **1M invocations, 4 h Active CPU, 360 GB-h memory**; 1,024 file descriptors shared per instance. Active CPU is not billed while awaiting I/O; memory is. | Vercel docs (limits, fluid-compute, usage-and-pricing, functions/limitations) |
| Neon Free: **100 CU-h/month**, scale-to-zero after **5 min** idle, **5 GB** network transfer/month, 1 GB storage. | Neon plans docs |
| `game.ver` is **not** bumped by `next-pick`, `start-presentation`, `next`. `playerVersion` only watches `status:game_id:game.ver:user.ver`. | `lib/game.ts` |
| `game.stage` has an inline `CHECK`; `schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so re-running the migration will **not** add a stage value. | `db/schema.sql`, `scripts/migrate.mjs` |

## 1. Rough budget, 100 phones, 3 h event (estimates, not measured)

| | Today | After plan |
| --- | --- | --- |
| Neon HTTP calls / s, steady | ~59 (50 SSE ticks + 8 backup polls + admin) | ~7 (10 leader streams + ~1.2 polls + admin) |
| Function invocations / h | ~40k (7k SSE reconnects, 30k backup polls, 2.4k admin) | ~7k |
| Per player at join | 3 invocations, ~7 statements | 1 invocation, 1 statement |

Neither plan comes near the free-tier ceilings for a single event; the point is headroom for rehearsals/load tests and removing pointless work (90 phones never receive an event).

## 2. Phases (in dependency order)

### Phase A: independent quick wins
1. `components/admin/Results.tsx:70`: remove the stray `aaaa` after `{q.text}` (shows on the projector under every question).
2. Vercel dashboard: confirm **Fluid compute is on**. Only then raise `maxDuration` (step D2). If off, Hobby caps at 60 s and the current 50 s rotation must stay.
3. Make `NoGame` poll (5 s, all phones, forever) jittered, back off to 30-60 s, and pause while the tab is hidden.
4. Reconnect/poll jitter helper in `lib/client.ts` (`jitter(minMs, maxMs)`), reused below.

### Phase B: join wave, one request per player
1. `createUsers`: also return `teams.name`, and `game_id` in the same statement (drop the extra `SELECT game_id` in `joinPlayer`).
2. `POST /api/join` returns what the home screen needs: `{ code, gameId, name, team, questions }`. `PlayerApp.enter` uses it directly; no follow-up `/api/me`, no stream opened.
3. `POST /api/login` stays as is (it is followed by one `/api/me`, which is fine).

### Phase C: split Assign / Choose (backend + admin UI)
Design choice: **no new stage value** (see fact about the `CHECK`). "Assigned" = `stage = 'lobby'` and `EXISTS (SELECT 1 FROM assignments)`.
1. `assignAllLeaders`: insert assignments only; **do not** touch `stage`. Guard: `stage = 'lobby'` and no assignments yet (second/triple click -> 409, same as today).
2. New admin action `start-picking` (in `advance`): `lobby -> picking, q_index = 0`, only `WHERE EXISTS (SELECT 1 FROM assignments)`. This is what the existing Picking show hangs off, unchanged.
3. Optional `unassign` (delete assignments while `stage = 'lobby'`) so the admin can redraw after moving people. `stop-presentation` already does the same from later stages.
4. Presence: `ALTER TABLE assignments ADD COLUMN IF NOT EXISTS seen_at timestamptz` (idempotent, safe on the live DB). Set when a leader's feed connects. `AdminState` exposes `leadersConnected / leadersTotal`.
5. `Live.tsx`: two buttons. "Assign leaders" -> after success show "Assigned - connected X of Y" and enable "Choose leaders" (which calls `start-picking`). Warn (not block) if X < Y. **Do not highlight leaders on the board** (the projector may be showing it).
6. `moveUser`: keep leaders locked; allow non-leader moves after assign (harmless).

### Phase D: player session + leader feed
1. **Status in `/api/me`:** add `phase: { assigned: boolean, leader: boolean }`. `leader` = has an assignment (revealed or not). Question/team text stay gated by `revealed_at` exactly as now. Never ship a list of leader codes to clients.
2. **Polling in `PlayerApp`:** unassigned and live: `jitter(40-130 s)` (recommend 20-60 s, see Decisions); immediately on `visibilitychange`/`online`. Assigned non-leader: slow poll (120-300 s, paused while hidden) just for reset/end/team change. Assigned leader: open the feed. Rework the "reconnecting" banner to follow poll/feed failures instead of SSE errors.
3. **Stream route:**
   - non-leader -> `204` (EventSource stops; the client must not open it unless `leader` is true, because the existing `onerror` reopens on CLOSED);
   - `maxDuration = 300` (after A2), self-close at `240 s + random(0-20 s)`, `retry` unchanged;
   - mark `seen_at` on connect.
4. **Version signature:** `playerVersion` must include `stage`, `q_index`, `timer_started_at` (epoch) and the player's assignment state, otherwise question changes never reach the feed. (Alternative: bump `ver` in `next-pick`/`start-presentation`/`next`; that also wakes admin-irrelevant clients, so extending the signature is cheaper.)
5. **Snapshot for leaders** adds `game: { stage, qIndex, questionCount, timerStartedAt, speakSeconds, serverNow }` and `leader.slot`, `leader.n`.
6. **Cue logic = pure function** in `lib/logic.ts`, e.g. `leaderCue({ stage, qIndex, myN, timerStartedAt, speakSeconds, nowServer }) -> "wait" | "chosen" | "warn" | "now" | "done"`. The phone computes cues from the snapshot and a server-clock offset (measured on receipt, like the admin does), never from a one-shot pushed event. This makes it correct after reconnects, late connections, phone wake-ups, skips, stop and reset. Dedup popups per `(assignmentId, qIndex, cue)` in `localStorage`.
   - warn when the previous question has <= 60 s left; if `speakSeconds <= 60`, warn at the start of the previous question;
   - if the admin skipped past the warn point, go straight to "now";
   - Q1 group: chosen popup carries "you speak first, head to the stage"; plus a "now" popup when the presentation starts (see Decisions);
   - `stop-presentation` / `reset` / game end: cue `done`, close the feed.
7. **UI (`Home.tsx`):** "now speaking" marker on the active question in the list, three popups (chosen, 1-minute warning, your turn), vibrate where supported (not iOS). Request a **Screen Wake Lock** while a leader is waiting; show "keep this screen on" in the chosen popup.
8. **Projector fallback:** in `Presenting.tsx`, show a "next up" strip with the next speakers from the 1-minute mark. Works even when a phone is locked.

### Phase E: tests and rollout
1. Update the 2-step flow in `tests/api.spec.ts` (10 refs), `tests/e2e.spec.ts` (12), `tests/simulation.spec.ts` (1), `README.md` event-day steps.
2. Rewrite the three SSE tests (100 streams, "moved player told live", rotation). New tests: assign triple-click, choose refused before assign, non-leader stream gets 204, signature changes on `next`, `leaderCue` unit tests (normal, skip, short timer, Q1 group, stop, reset, reconnect after warn point), presence count, join returns full payload.
3. Run the suite on the isolated harness first (see memory: the real DB may hold a live game).
4. After deploy: `BASE_URL=<prod> E2E_ADMIN_SECRET=<secret> pnpm test:load` on an empty game; compare Vercel Usage and Neon dashboards before/after. **Go/no-go for SSE:** if leader streams misbehave on Vercel, switch the feed to 3 s polling of the same snapshot (the backup poll already exists), no other change needed.
5. Device pass: iPhone Safari and Android Chrome with a locked screen, backgrounded tab, flight-mode toggle, 5+ minute stream.

## 3. Decisions for the owner (recommendation first)

| # | Question | Recommendation |
| --- | --- | --- |
| D1 | Leader transport | SSE for leaders as proposed, keep the backup poll, decide after the prod load test. Polling at ~3 s for ~10 phones is an equally good fallback. |
| D2 | Poll window while waiting for assignment | 20-60 s instead of 40-130 s (still ~20x cheaper than today; shortens the Assign->Choose wait to <= 1 min). Keep the connected X/Y indicator either way. |
| D3 | Q1 group "go to the stage" | At the chosen popup (as you said) **and** again when the presentation starts: the draw + results screen can take minutes before Q1's timer begins. |
| D4 | Warn when `speakSeconds <= 60` | Warn at the start of the previous question. |
| D5 | Moves after Assign | Allow for non-leaders. |
| D6 | Leader flag visible before reveal (anyone can query `/api/me?code=NNN`) | Accept; send only a boolean, no question/team text before reveal. |

## 4. Risks that stay after the plan
- A locked/backgrounded phone cannot run timers or hold a stream: popups appear only when the screen is on. Wake Lock and the projector strip reduce, not remove, this. Web Push is not worth it here (needs a sender at the 1-minute mark and, on iOS, an installed home-screen app).
- 3-digit code is the only credential: names/teams can be enumerated. Any future rate limit must not be per-IP (100 phones share the venue's IP).
- No idempotency key on join: a lost response + manual retry creates a second player.

## 5. As built (differences from the proposal)

All decisions followed the recommendations (D1 SSE for leaders with the backup poll, D2 20-60 s, D3 both popups for the first group, D4 warn from the start when the speaking time is <= 60 s, D5 non-leader moves allowed, D6 boolean flag accepted).

- **Idle poll** for assigned non-leaders is 60-150 s (not 120-300 s): the "game over" notice reaches them within ~2.5 minutes at a cost of ~1 request/s for 100 phones.
- **Presence** (`assignments.seen_at`) is refreshed by the feed (connect + 15 s heartbeat) and by a leader's `/api/me` poll; "connected" = seen in the last 60 s.
- **Join** returns `{ code, gameId, snapshot }`; login is unchanged (followed by one `/api/me`).
- **Feed route** returns `204` for non-leaders/unknown code/stale game, `503` on DB errors; `maxDuration = 300`; rotation at `SSE_MAX_MS` (default 240 s) + up to 8% jitter. The version signature now covers stage, question index, timer start, assignment id/revealed and "a draw exists".
- **Assign** no longer changes the stage; a second concurrent draw fails on the UNIQUE team/user columns (-> 409 "already assigned"); the INSERT also drops a draw whose leader changed team in between (-> 409 stale).
- **Phones**: unregistered tabs close the feed while hidden and reopen it (plus an immediate check) on wake; the "reconnecting" banner follows poll/feed failures and the browser's offline event.
- **Projector**: the "next up" strip is overlaid in the middle of the header (a flex slot made the 1280x720 header overflow).
- Not built: Web Push, per-IP rate limits, a join idempotency key (still listed under risks).
- **Deploy order:** run `pnpm db:migrate` against Neon *before* deploying (adds `assignments.seen_at`); confirm Fluid compute is on or set `SSE_MAX_MS=50000`.
