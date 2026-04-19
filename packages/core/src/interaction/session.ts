import { z } from "zod";
import { AutomationModeSchema, type AutomationMode } from "./modes.js";
import { ExecutionStateSchema, InteractionEventSchema, type InteractionEvent } from "./events.js";

export const PendingDecisionSchema = z.object({
  kind: z.string().min(1),
  bookId: z.string().min(1),
  chapterNumber: z.number().int().min(1).optional(),
  summary: z.string().min(1),
});

export type PendingDecision = z.infer<typeof PendingDecisionSchema>;

export const InteractionMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
});

export type InteractionMessage = z.infer<typeof InteractionMessageSchema>;

export const BookCreationDraftSchema = z.object({
  concept: z.string().min(1),
  title: z.string().min(1).optional(),
  genre: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
  language: z.enum(["zh", "en"]).optional(),
  targetChapters: z.number().int().min(1).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
  blurb: z.string().min(1).optional(),
  worldPremise: z.string().min(1).optional(),
  settingNotes: z.string().min(1).optional(),
  protagonist: z.string().min(1).optional(),
  supportingCast: z.string().min(1).optional(),
  conflictCore: z.string().min(1).optional(),
  volumeOutline: z.string().min(1).optional(),
  constraints: z.string().min(1).optional(),
  authorIntent: z.string().min(1).optional(),
  currentFocus: z.string().min(1).optional(),
  nextQuestion: z.string().min(1).optional(),
  missingFields: z.array(z.string().min(1)).default([]),
  readyToCreate: z.boolean().default(false),
});

export type BookCreationDraft = z.infer<typeof BookCreationDraftSchema>;

function coerceOptionalTrimmedString(value: unknown, fallback?: string): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof fallback === "string" && fallback.trim().length > 0) {
    return fallback.trim();
  }
  return undefined;
}

function coerceRequiredTrimmedString(value: unknown, fallback?: string): string {
  const resolved = coerceOptionalTrimmedString(value, fallback);
  if (!resolved) {
    throw new Error("Book creation draft requires a non-empty concept.");
  }
  return resolved;
}

function coercePositiveInteger(value: unknown, fallback?: number): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (typeof fallback === "number" && Number.isInteger(fallback) && fallback > 0) {
    return fallback;
  }
  return undefined;
}

function coerceLanguage(value: unknown, fallback?: "zh" | "en"): "zh" | "en" | undefined {
  if (value === "zh" || value === "en") {
    return value;
  }
  return fallback;
}

function coerceMissingFields(
  value: unknown,
  fallback?: ReadonlyArray<string>,
): string[] {
  const source = Array.isArray(value) ? value : fallback ?? [];
  return source
    .filter((field): field is string => typeof field === "string")
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
}

export function normalizeCreationDraft(
  draft: unknown,
  fallback?: Partial<BookCreationDraft>,
): BookCreationDraft {
  const source = draft && typeof draft === "object"
    ? draft as Record<string, unknown>
    : {};

  return BookCreationDraftSchema.parse({
    concept: coerceRequiredTrimmedString(source.concept, fallback?.concept),
    title: coerceOptionalTrimmedString(source.title, fallback?.title),
    genre: coerceOptionalTrimmedString(source.genre, fallback?.genre),
    platform: coerceOptionalTrimmedString(source.platform, fallback?.platform),
    language: coerceLanguage(source.language, fallback?.language),
    targetChapters: coercePositiveInteger(source.targetChapters, fallback?.targetChapters),
    chapterWordCount: coercePositiveInteger(source.chapterWordCount, fallback?.chapterWordCount),
    blurb: coerceOptionalTrimmedString(source.blurb, fallback?.blurb),
    worldPremise: coerceOptionalTrimmedString(source.worldPremise, fallback?.worldPremise),
    settingNotes: coerceOptionalTrimmedString(source.settingNotes, fallback?.settingNotes),
    protagonist: coerceOptionalTrimmedString(source.protagonist, fallback?.protagonist),
    supportingCast: coerceOptionalTrimmedString(source.supportingCast, fallback?.supportingCast),
    conflictCore: coerceOptionalTrimmedString(source.conflictCore, fallback?.conflictCore),
    volumeOutline: coerceOptionalTrimmedString(source.volumeOutline, fallback?.volumeOutline),
    constraints: coerceOptionalTrimmedString(source.constraints, fallback?.constraints),
    authorIntent: coerceOptionalTrimmedString(source.authorIntent, fallback?.authorIntent),
    currentFocus: coerceOptionalTrimmedString(source.currentFocus, fallback?.currentFocus),
    nextQuestion: coerceOptionalTrimmedString(source.nextQuestion, fallback?.nextQuestion),
    missingFields: coerceMissingFields(source.missingFields, fallback?.missingFields),
    readyToCreate: typeof source.readyToCreate === "boolean"
      ? source.readyToCreate
      : (fallback?.readyToCreate ?? false),
  });
}

export const InteractionSessionSchema = z.object({
  sessionId: z.string().min(1),
  projectRoot: z.string().min(1),
  activeBookId: z.string().min(1).optional(),
  activeChapterNumber: z.number().int().min(1).optional(),
  creationDraft: BookCreationDraftSchema.optional(),
  automationMode: AutomationModeSchema.default("semi"),
  messages: z.array(InteractionMessageSchema).default([]),
  events: z.array(InteractionEventSchema).default([]),
  pendingDecision: PendingDecisionSchema.optional(),
  currentExecution: ExecutionStateSchema.optional(),
});

export type InteractionSession = z.infer<typeof InteractionSessionSchema>;

export function bindActiveBook(
  session: InteractionSession,
  bookId: string,
  chapterNumber?: number,
): InteractionSession {
  return {
    ...session,
    activeBookId: bookId,
    ...(chapterNumber !== undefined ? { activeChapterNumber: chapterNumber } : {}),
  };
}

export function clearPendingDecision(session: InteractionSession): InteractionSession {
  if (!session.pendingDecision) {
    return session;
  }

  return {
    ...session,
    pendingDecision: undefined,
  };
}

export function updateCreationDraft(
  session: InteractionSession,
  draft: BookCreationDraft,
): InteractionSession {
  return {
    ...session,
    creationDraft: normalizeCreationDraft(draft, session.creationDraft),
  };
}

export function clearCreationDraft(session: InteractionSession): InteractionSession {
  if (!session.creationDraft) {
    return session;
  }

  return {
    ...session,
    creationDraft: undefined,
  };
}

export function updateAutomationMode(
  session: InteractionSession,
  automationMode: AutomationMode,
): InteractionSession {
  return {
    ...session,
    automationMode,
  };
}

export function appendInteractionMessage(
  session: InteractionSession,
  message: InteractionMessage,
): InteractionSession {
  return {
    ...session,
    messages: [...session.messages, message].sort((left, right) => left.timestamp - right.timestamp),
  };
}

export function appendInteractionEvent(
  session: InteractionSession,
  event: InteractionEvent,
): InteractionSession {
  return {
    ...session,
    events: [...session.events, event],
  };
}
