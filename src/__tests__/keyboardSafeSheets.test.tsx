/**
 * KEYBOARD-SHEETS — a sheet with a text field keeps the field and its send
 * button above the keyboard.
 *
 * 1. Behaviour: the coach insight review sheet and the Ask AI sheet put the
 *    field AND the send button inside a KeyboardAvoidingView, so on iOS the
 *    sheet rises with the keyboard (the app's pattern since NudgeModal and
 *    LogPlannedMealButton). Ask AI's form also scrolls, with taps passing
 *    through while the keyboard is up, so "Send to AI" can never sit off screen.
 * 2. Class guard: every non-test file that opens a <Modal> holding a
 *    <TextInput> must be keyboard-safe (a padding KeyboardAvoidingView, a
 *    ScrollView with automaticallyAdjustKeyboardInsets, or the shared Screen,
 *    whose footer rises with the keyboard), or be listed below with its reason.
 *    A new sheet that forgets the keyboard fails here.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@expo/vector-icons', () => {
  function Icon() {
    return null;
  }
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
jest.mock('../theme/ThemeProvider', () => {
  const colors = new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' ? `#${prop}` : '#000') });
  const Pass = ({ children }: { children: React.ReactNode }) => children;
  return { __esModule: true, ThemeProvider: Pass, default: Pass, useTheme: () => ({ colors }) };
});
jest.mock('../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('../services/api', () => {
  const get = jest.fn();
  const post = jest.fn();
  return { __esModule: true, default: { get, post, defaults: { baseURL: 'http://test.local/api' } }, get, post };
});
jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../api/coachAiExecutionApi', () => ({
  coachAiExecutionApi: { invokeSendNotification: jest.fn() },
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', role: 'coach', firstName: 'Casey' }),
}));
const mockUseCoachInsight = jest.fn();
jest.mock('../hooks/useWearableInsight', () => ({
  useCoachInsight: (args: unknown) => mockUseCoachInsight(args),
  useApproveDraft: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));

import { AskAiActionSheet } from '../components/coach/ai-execution/AskAiActionSheet';
import { WearableInsightPanel } from '../screens/coach/client-detail/WearableInsightPanel';

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
});

describe('coach insight review sheet rides above the keyboard', () => {
  it('the draft box, Approve, Edit-then-send and Dismiss all sit inside the keyboard avoider; the backdrop still closes', async () => {
    mockUseCoachInsight.mockReturnValue({
      data: {
        observation: 'Deep sleep down 40% vs baseline this week',
        hypothesis: 'Possibly late caffeine',
        suggested_action: 'Ask about evenings',
        suggested_message_draft: 'Hey, noticed your deep sleep dipped. Anything change in your evenings?',
        confidence_level: 'fairly_sure',
        source_metrics: ['SLEEP_DEEP_MIN'],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    });
    const r = await render(<WearableInsightPanel side="coach" bucket="SLEEP_RECOVERY" clientId="client-1" />);
    await fireEvent.press(r.getByTestId('coach-insight-panel'));
    await fireEvent.press(r.getByTestId('coach-insight-review-cta'));
    const avoider = r.getByTestId('coach-insight-keyboard-avoider');
    for (const id of ['coach-insight-draft-input', 'coach-insight-approve', 'coach-insight-edit-send', 'coach-insight-dismiss']) {
      expect(within(avoider).getByTestId(id)).toBeTruthy();
    }
    await fireEvent.press(r.getByLabelText('Dismiss the review sheet'));
    expect(r.queryByTestId('coach-insight-keyboard-avoider')).toBeNull();
  });
});

describe('Ask AI sheet rides above the keyboard', () => {
  it('both fields and Send to AI sit in a scrolling form inside the keyboard avoider; taps pass through with the keyboard up', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = await render(
      <QueryClientProvider client={qc}>
        <AskAiActionSheet visible clientId="c1" clientName="Jane" onClose={jest.fn()} />
      </QueryClientProvider>,
    );
    await fireEvent.press(r.getByTestId('ask-ai-option-draft.send_notification'));
    const avoider = r.getByTestId('ask-ai-keyboard-avoider');
    const form = within(avoider).getByTestId('ask-ai-form');
    expect(form.props.keyboardShouldPersistTaps).toBe('handled');
    for (const id of ['ask-ai-body-input', 'ask-ai-prompt-input', 'ask-ai-submit']) {
      expect(within(form).getByTestId(id)).toBeTruthy();
    }
  });
});

// ── Class guard ──────────────────────────────────────────────────────────────
const SRC = path.join(__dirname, '..');
const KEYBOARD_SAFE = [
  /<KeyboardAvoidingView[^>]*behavior=\{Platform\.OS === ['"]ios['"] \? ['"]padding['"]/,
  /automaticallyAdjustKeyboardInsets/,
  /<Screen\b/, // src/ui/layout/Screen: its footer sits in a KeyboardAvoidingView
];
/** Files that open a Modal with a TextInput but need no keyboard handling, and why. */
const NOT_NEEDED: Record<string, string> = {
  'components/community/SpaceDrawer.tsx': 'search field sits at the top of the drawer',
  'screens/coach/CoachCodesScreen.tsx': 'its fields are on the screen, not in a modal',
  'screens/coach/SubCoachInviteModal.tsx': 'Team Mode is v1.1 (owner #COACH-TABS)',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, out);
    } else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('every sheet with a text field is keyboard-safe', () => {
  const files = walk(SRC)
    .map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join('/'), code: fs.readFileSync(f, 'utf8') }))
    .filter(({ code }) => /<Modal\b/.test(code) && /<TextInput\b/.test(code));

  it('finds the sheets this guard is about', () => {
    expect(files.map((f) => f.rel)).toEqual(
      expect.arrayContaining([
        'screens/coach/client-detail/WearableInsightPanel.tsx',
        'components/coach/ai-execution/AskAiActionSheet.tsx',
      ]),
    );
  });

  it.each(files.map((f) => [f.rel, f.code]))('%s keeps its field above the keyboard', (rel, code) => {
    if (NOT_NEEDED[rel]) return;
    expect(KEYBOARD_SAFE.some((re) => re.test(code))).toBe(true);
  });

  it('every NOT_NEEDED entry still exists and still opens a Modal with a TextInput', () => {
    for (const rel of Object.keys(NOT_NEEDED)) {
      expect(files.some((f) => f.rel === rel)).toBe(true);
    }
  });
});
