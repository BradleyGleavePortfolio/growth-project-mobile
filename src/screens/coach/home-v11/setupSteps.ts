/**
 * UI-2 zero-client Home (V1_1_UI_SPEC UI-2, mockup new-coach-zero-clients): the setup steps as dial, Roman line
 * and step tiles. The ticks and words are the Home checklist's own (buildChecklist over loadSetupStatus, every
 * tick from a live route); the mockup supplies the step numbers, "First client payment" and the actions.
 */
import { buildChecklist, toChecklistStatus, type ChecklistTarget } from '../../../components/coach/setup/CoachSetupChecklist';
import type { SetupSnapshot } from '../../../lib/coachSetup/setupStatus';
import type { DialSpec } from './HomeParts';

export interface SetupStep {
  key: ChecklistTarget;
  step: number;
  title: string;
  detail: string;
  /** null = the read failed, so the tile says it could not be checked. */
  done: boolean | null;
  action: string | null;
}

export interface SetupPlan {
  done: number;
  total: number;
  /** The steps not yet ticked, in order (an unknown one included). */
  open: SetupStep[];
  stripeReady: boolean;
  /** The first open step is the package and every step before it is ticked. */
  packageNext: boolean;
}

const TITLE: Partial<Record<ChecklistTarget, string>> = { money: 'First client payment' };
const ACTION: Record<ChecklistTarget, string | null> = { get_paid: 'Connect Stripe', package: 'Create', invite: 'Share link', money: null };

/** Null when setup is not this coach's (an active sub-coach: the head coach's practice sets up Stripe and packages). */
export function setupPlan(s: SetupSnapshot): SetupPlan | null {
  if (s.headCoachHandlesMoney) return null;
  const steps: SetupStep[] = buildChecklist(toChecklistStatus(s)).map((it, i) => ({
    key: it.key, step: i + 1, title: TITLE[it.key] ?? it.label, detail: it.detail, done: it.done, action: ACTION[it.key],
  }));
  const open = steps.filter((st) => st.done !== true);
  return {
    done: steps.length - open.length,
    total: steps.length,
    open,
    stripeReady: s.connect?.state === 'active',
    packageNext: open[0]?.key === 'package' && open[0].done === false,
  };
}

export function setupDial(p: SetupPlan): DialSpec {
  return {
    key: 'setup', value: `${p.done} of ${p.total}`, unit: 'steps', label: 'Setup',
    sub: p.stripeReady ? 'Stripe is ready' : undefined, progress: p.done / p.total,
  };
}

/** The mockup's Roman line, only when it is true: the package is next. */
export const PACKAGE_NEXT_LINE = 'Next is your first package. Once it is live, share your link and the rings start to fill.';
