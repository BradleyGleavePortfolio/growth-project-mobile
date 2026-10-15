/**
 * FIX684 (Sol B1 on m#684): every consent record names the exact screen the client was shown, and its
 * version and digest rebuild every word on it, in both memory states.
 *
 * ROWS is every P0 screen this build shows: with a coach and with no coach (W-CONSENT: the Roman choice
 * under "Before you join a coach"), memory off and on. Each row renders the real flow to P0, reads every
 * string shown from the title to the Privacy Policy link in display order, agrees, and proves the saved
 * record's `text_sha256` is the sha256 of exactly those strings and that its version and digest are the
 * backend's (growth-project-backend test/ai-consent/consent-coachless-screen.spec.ts pins the same values).
 */
import React from 'react';
import { createHash } from 'crypto';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow from '../ConsultationFlow';
import type { AiConsentUpgradeCopy } from '../../../api/aiConsentApi';
import { NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { aiStatus, makeApi, resetStores } from '../../../lib/consultation/__fixtures__/flowHarness';
import {
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_MEMORY_COPY_SHA256,
  AI_CONSENT_PARAGRAPH,
  CONSENT_TITLE,
  consentCopyText,
  consentScreenCopy,
} from '../../../lib/consultation/copy';

jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {},
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/sentry', () => ({ setSentryUser: jest.fn(), captureError: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ reset: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'u1' })),
  readUserCache: jest.fn(async () => null),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock('../../../offline/sync/sync-engine', () => ({ deleteWorkoutLogsForUser: jest.fn(async () => 0) }));
jest.mock('../../../services/queryClient', () => ({
  retireAndDrainIdentityPersistences: jest.fn(async () => undefined),
  settleAndClearQueryCache: jest.fn(async () => undefined),
  purgePersistedQueryCacheForAllUsers: jest.fn(async () => undefined),
}));

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

// The server's client-ai-v7 paragraph (memory on), as it sends it. Verbatim.
const MEMORY_PARAGRAPH =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman may also learn your coach's methods, including from your coach's private session notes, and information about your training may help with that without identifying you. Roman never quotes those notes or shows you another client's information. Your coach never sees your conversations with Roman or his notes about you. One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you. Your conversations with Roman are kept until you delete them or delete your account.";
const MEMORY_COPY: AiConsentUpgradeCopy = {
  version: 'client-ai-v7',
  paragraph: { text: MEMORY_PARAGRAPH, sha256: sha(MEMORY_PARAGRAPH) },
  box_label: { text: AI_CONSENT_CHECKBOX_LABEL, sha256: sha(AI_CONSENT_CHECKBOX_LABEL) },
  sha256: AI_CONSENT_MEMORY_COPY_SHA256,
};

/** Every string on screen from the P0 title to the Privacy Policy link, in display order. */
function shownConsentText(r: Awaited<ReturnType<typeof render>>): string {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') walk((n as { children?: unknown }).children ?? null);
  };
  walk(r.toJSON());
  const end = out.indexOf('Privacy Policy');
  return out.slice(out.lastIndexOf(CONSENT_TITLE, end), end).join('\n\n');
}

// [screen, no coach, memory on, P0 version recorded, its digest (= the backend pin)]
const ROWS: Array<[string, boolean, boolean, string, string]> = [
  ['coached, memory off', false, false, 'consult-consent-v7', '7711079209acecedfb50c31787787124af843f076154e9bfbd1e33550e861e09'],
  ['coached, memory on', false, true, 'consult-consent-v8', 'b98e160e884aecdca059b90f7a88803ba84eeac79b692e83eba9f734f93274b2'],
  ['no coach, memory off', true, false, 'consult-consent-v8-coach-free', '5369ee9c57412dd2233850a7cae2043a32645431ee3b3484a14c19b8c503c633'],
  ['no coach, memory on', true, true, 'consult-consent-v9-coach-free', '4a1e19730f3fab3b8a6a8119f5425cd3c0f6ed2f502d229d25dbb7fe5df35771'],
];

beforeEach(async () => {
  await resetStores();
});

describe('FIX684: each P0 record rebuilds the screen shown (coached, no coach, each memory state)', () => {
  it.each(ROWS)('%s', async (_screen, noCoach, memory, version, pin) => {
    const status = memory ? aiStatus({ memory_on: true, memory_copy: MEMORY_COPY }) : aiStatus();
    const api = makeApi({ getRomanConsent: jest.fn(async () => ({ kind: 'ok' as const, status })) });
    const r = await render(
      <ConsultationFlow
        userId="u1"
        firstName="Maya"
        coachName={noCoach ? null : 'Bradley'}
        coachless={noCoach}
        api={api}
        onFinished={jest.fn()}
        now={() => NOW}
        autoAdvanceMs={0}
        prepMinMs={0}
      />,
    );
    await waitFor(() => r.getByTestId('consult-screen-W1'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await waitFor(() => expect(api.getRomanConsent).toHaveBeenCalled());
    const paragraph = memory ? MEMORY_PARAGRAPH : AI_CONSENT_PARAGRAPH;
    await waitFor(() => expect(r.getByTestId('consent-ai-paragraph').props.children).toBe(paragraph));
    const shown = shownConsentText(r);
    expect(shown.split('\n\n')).toEqual(consentCopyText(memory ? MEMORY_PARAGRAPH : undefined, noCoach).split('\n\n'));
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    const p0 = api.save.mock.calls[0][0].answers.P0;
    expect(p0).toMatchObject({ agreed: true, copy_version: version, text_sha256: pin });
    expect(sha(shown)).toBe(p0.text_sha256);
  });

  it('the list is complete: the rows are every version and digest a P0 screen can record', () => {
    const recorded = [false, true].flatMap((noCoach) => {
      const c = consentScreenCopy(noCoach);
      return [
        [c.version, c.sha256],
        [c.memoryVersion, c.memorySha256],
      ];
    });
    expect(recorded).toEqual(ROWS.map(([, , , v, pin]) => [v, pin]));
  });
});
