/**
 * coachConsultationApi — coach read of a client's consultation answers
 * (owner decision 2026-09-30: the coach sees every client's consultation
 * answers, easily).
 *
 * Contract: backend PR #607 docs/clinic-onboarding.md,
 *   GET /api/coach/clients/:clientId/consultation[?revision=N]
 * Every refusal (foreign coach, no intake yet, unknown client) is the same
 * 404 "Consultation not found". Until #607 is deployed the route itself is
 * missing, and Nest answers its router 404 ("Cannot GET ..."). The screen
 * tells those two apart so the coach gets an honest message either way:
 *   - `unavailable`: this server does not have the consultation view yet;
 *   - `none`: no answers on file for this client (or no access).
 * Any other failure throws, and the screen offers a retry.
 */
import axios from "axios";
import { z } from "zod";
import api from "../services/api";

const AnswerSchema = z.object({
  screen: z.string(),
  question: z.string(),
  answer_label: z.string(),
});

const ChapterSchema = z.object({
  key: z.string(),
  title: z.string(),
  answers: z.array(AnswerSchema),
});

const ScreeningItemSchema = z.object({
  key: z.string(),
  question: z.string(),
  answer: z.enum(["yes", "no"]).nullable(),
  note: z.string().nullable(),
});

export const ConsultationViewSchema = z.object({
  version: z.string(),
  revision: z.number(),
  revision_cause: z.string(),
  submitted_at: z.string().nullable(),
  saved_at: z.string(),
  chapters: z.array(ChapterSchema),
  screening: z.object({
    any_yes: z.boolean(),
    items: z.array(ScreeningItemSchema),
  }),
  consent: z.object({
    version: z.string().nullable(),
    agreed_at: z.string().nullable(),
  }),
});

export type ConsultationView = z.infer<typeof ConsultationViewSchema>;

export type ConsultationResult =
  | { kind: "ok"; view: ConsultationView }
  | { kind: "none" }
  | { kind: "unavailable" };

/** Nest's router 404 for a path no controller handles ("Cannot GET /api/..."). */
export function isRouteMissing(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const message = (data as { message?: unknown }).message;
  return typeof message === "string" && message.startsWith("Cannot GET");
}

export async function fetchClientConsultation(
  clientId: string,
): Promise<ConsultationResult> {
  try {
    const res = await api.get(
      `/coach/clients/${encodeURIComponent(clientId)}/consultation`,
    );
    return { kind: "ok", view: ConsultationViewSchema.parse(res.data) };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return isRouteMissing(err.response.data)
        ? { kind: "unavailable" }
        : { kind: "none" };
    }
    throw err;
  }
}
