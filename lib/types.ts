// Types shared between the server and the browser.

export type Status = "prep" | "live" | "finished";
export type Stage = "lobby" | "picking" | "results" | "presenting" | "finished";

/** What a phone needs to know to decide how to stay in sync. `leader` is true as soon as a draw exists (before the reveal). */
export type Phase = { assigned: boolean; leader: boolean };

/** Timing of the live game, sent to leaders only (the phone derives every cue from it). */
export type FeedGame = {
  stage: Stage;
  qIndex: number;
  questionCount: number;
  timerStartedAt: number | null;
  speakSeconds: number;
  /** Server clock (ms) when this snapshot was read; the phone keeps the offset to its own clock. */
  serverNow: number;
};

export type PlayerLeader = { assignmentId: number; n: number; text: string; team: string; slot: number };

export type PlayerSnapshot =
  | { live: false }
  | { live: true; gameId: number; user: null }
  | {
      live: true;
      gameId: number;
      user: { name: string; code: number; team: string };
      questions: { id: number; n: number; text: string }[];
      /** Only after the admin screen revealed this player. */
      leader: PlayerLeader | null;
      phase: Phase;
      /** Present while the player has an assignment. */
      feed: FeedGame | null;
    };

export type JoinResult = { code: number; gameId: number; snapshot: PlayerSnapshot };

export type AdminMember = { id: number; name: string; code: number; isLeader: boolean };
export type AdminTeam = { id: number; name: string; members: AdminMember[] };
export type AdminAssignment = {
  id: number;
  questionId: number;
  teamId: number;
  teamName: string;
  userId: number;
  userName: string;
  userCode: number;
  slot: number;
  revealed: boolean;
  /** The leader's phone checked in during the last minute. */
  connected: boolean;
};

export type AdminState = {
  serverNow: number;
  game: {
    status: Status;
    stage: Stage;
    qIndex: number;
    timerStartedAt: number | null;
    speakSeconds: number;
    pauseSeconds: number;
    revealSeconds: number;
    scrollSeconds: number;
    isSimulation: boolean;
    gameId: number;
  };
  teams: AdminTeam[];
  questions: { id: number; text: string }[];
  assignments: AdminAssignment[];
  playerCount: number;
};

export type AdvanceAction =
  | "start-picking"
  | "unassign"
  | "next-pick"
  | "start-presentation"
  | "stop-presentation"
  | "next"
  | "new-game"
  | "reset";
