/**
 * Server side of the coach consultation (backend contract COACH-CONSULT-BE-134):
 *   GET  /coach/consultation           prefill or resume
 *   PUT  /coach/consultation           save the draft (best effort)
 *   POST /coach/consultation/complete  save every answer, open the coach app
 * Until those routes are deployed they answer 404: the flow keeps the local
 * draft, and completion falls back to the existing wizard routes
 * (/coach/onboarding steps + complete) that RootNavigator already reads, with
 * the answers kept in the wizard's step data so nothing is lost.
 */
import api from '../../services/api';
import { advanceWizardTo, coachSetupApi } from '../../api/coachSetupApi';
import { errorStatus } from '../../types/common';
import { isStepId, sanitizeAnswers, wireAnswers } from './flow';
import type { CoachConsultAnswers, CoachStepId } from './types';

export interface ServerConsultation {
  status: 'not_started' | 'in_progress' | 'complete';
  step: CoachStepId | null;
  answers: CoachConsultAnswers;
  updatedAt: string | null;
}

export type SaveResult = 'saved' | 'unavailable' | 'failed';

export interface CoachConsultApi {
  /** null when the route is not deployed or unreachable (the local draft decides). */
  load(): Promise<ServerConsultation | null>;
  saveDraft(answers: CoachConsultAnswers, step: CoachStepId): Promise<SaveResult>;
  /** Resolves once the coach app gate (GET /coach/onboarding) reads complete; throws otherwise. */
  complete(answers: CoachConsultAnswers): Promise<void>;
}

const notDeployed = (err: unknown) => {
  const s = errorStatus(err);
  return s === 404 || s === 405;
};

function toServer(data: unknown): ServerConsultation | null {
  const d = (data ?? {}) as Record<string, unknown>;
  const status = d.status;
  if (status !== 'not_started' && status !== 'in_progress' && status !== 'complete') return null;
  return {
    status,
    step: isStepId(d.step) ? d.step : null,
    answers: sanitizeAnswers(d.answers),
    updatedAt: typeof d.updated_at === 'string' ? d.updated_at : null,
  };
}

export const coachConsultApi: CoachConsultApi = {
  async load() {
    try {
      const res = await api.get('/coach/consultation');
      return toServer(res.data);
    } catch {
      // 404 (not deployed), offline or 5xx: resume from the local draft.
      return null;
    }
  },

  async saveDraft(answers, step) {
    try {
      await api.put('/coach/consultation', { ...wireAnswers(answers), step });
      return 'saved';
    } catch (err) {
      return notDeployed(err) ? 'unavailable' : 'failed';
    }
  },

  async complete(answers) {
    const body = wireAnswers(answers);
    try {
      await api.post('/coach/consultation/complete', body);
      return;
    } catch (err) {
      if (!notDeployed(err)) throw err;
    }
    // Backend before COACH-CONSULT-BE-134: walk the existing wizard to its
    // final step with the answers attached, then complete it (idempotent).
    await advanceWizardTo(6, { coach_consultation: body });
    await coachSetupApi.complete();
  },
};
