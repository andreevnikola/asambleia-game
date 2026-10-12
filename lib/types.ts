// Types shared between the server and the browser.

export type Status = "prep" | "live" | "finished";
export type Stage = "lobby" | "picking" | "results" | "presenting" | "finished";

export type PlayerSnapshot =
  | { live: false }
  | { live: true; gameId: number; user: null }
  | {
      live: true;
      gameId: number;
      user: { name: string; code: number; team: string };
      questions: { id: number; n: number; text: string }[];
      leader: { assignmentId: number; n: number; text: string; team: string } | null;
    };

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

export type AdvanceAction = "next-pick" | "start-presentation" | "stop-presentation" | "next" | "new-game" | "reset";
