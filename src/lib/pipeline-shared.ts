import { z } from "zod";
import type { StageKind } from "./db/schema";

// Client-safe pipeline constants and types (no database imports), shared by lib/pipeline.ts,
// the board and the stage settings editor.

export const STAGE_COLORS = ["slate", "blue", "violet", "amber", "emerald", "rose", "cyan"] as const;
export type StageColor = (typeof STAGE_COLORS)[number];
export const STAGE_KINDS = ["open", "won", "lost"] as const satisfies readonly StageKind[];
export type { StageKind };

export type Stage = {
  id: string;
  name: string;
  position: number;
  kind: StageKind;
  color: StageColor;
  rotDays: number | null;
  probability: number;
};

export const DEFAULT_STAGES: Omit<Stage, "id" | "position">[] = [
  { name: "New lead", kind: "open", color: "slate", rotDays: 7, probability: 10 },
  { name: "Qualified", kind: "open", color: "blue", rotDays: 7, probability: 25 },
  { name: "Call booked", kind: "open", color: "violet", rotDays: 5, probability: 50 },
  { name: "Proposal", kind: "open", color: "amber", rotDays: 10, probability: 70 },
  { name: "Won", kind: "won", color: "emerald", rotDays: null, probability: 100 },
  { name: "Lost", kind: "lost", color: "rose", rotDays: null, probability: 0 },
];

/** Most contacts one move (or undo) may touch. */
export const MAX_MOVE = 200;
/** Most stages a pipeline may have. */
export const MAX_STAGES = 20;
/** How long after a move its Undo still works. */
export const UNDO_WINDOW_MS = 10 * 60_000;

/** A contact that moved: enough to put it back (see undoMove). */
export type MovedContact = {
  contactId: string;
  fromStageId: string;
  /** ISO time the contact entered its previous stage (restored by undo), or null. */
  fromChangedAt: string | null;
  eventId: string;
};

export const stageInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give every stage a name.")
    .max(40, "Keep stage names under 40 characters."),
  kind: z.enum(STAGE_KINDS),
  color: z.enum(STAGE_COLORS),
  rotDays: z.number().int().min(1, "Rotting starts after at least 1 day.").max(365, "Rotting can start after at most 365 days.").nullable(),
  probability: z.number().int().min(0, "Win probability is between 0 and 100 %.").max(100, "Win probability is between 0 and 100 %."),
});
export type StageInput = z.infer<typeof stageInput>;
