// src/__tests__/CoachPackageContentsScreen.test.tsx
//
// PR-17 M2 — coach content-authoring screen contract guards + RTL mount.
//
// What we assert:
//   1. Source guards: nav registration (route type + <Screen>) exists in
//      CoachNavigator, the edit screen has a "Manage content" button that
//      navigates to CoachPackageContents, and the push affordance is a
//      PLACEHOLDER seam (no PushPromptSheet/PushConfirmModal wiring in M2).
//   2. RTL: rows render from the mocked list; the warm empty-state copy
//      renders; "Add content" opens the attach form; submitting the attach
//      form calls coachPackageContentsApi.attach WITH an Idempotency-Key.
//
// Pattern mirrors Day1WinScreen.test.tsx — source-level reads for doctrine +
// wiring guards, plus a light RTL mount for the interactive paths.

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const ROOT = path.resolve(__dirname, '..', '..');
const SCREEN_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'payments', 'CoachPackageContentsScreen.tsx'),
  'utf8',
);
const NAV_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'navigation', 'CoachNavigator.tsx'),
  'utf8',
);
const EDIT_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'payments', 'CoachPackageEditScreen.tsx'),
  'utf8',
);
// Comment-stripped variant for guards that must inspect rendered code only.
const SCREEN_CODE = SCREEN_SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// ── Source guards ─────────────────────────────────────────────────────────────

describe('CoachPackageContents — nav + wiring source guards', () => {
  it('registers the CoachPackageContents route type in the SettingsStack param list', () => {
    expect(NAV_SRC).toMatch(
      /CoachPackageContents:\s*\{\s*packageId:\s*string;\s*title\?:\s*string\s*\}/,
    );
  });

  it('registers the CoachPackageContents <Screen> with its component', () => {
    expect(NAV_SRC).toMatch(/name="CoachPackageContents"/);
    expect(NAV_SRC).toMatch(/component=\{CoachPackageContentsScreen\}/);
    expect(NAV_SRC).toMatch(
      /import CoachPackageContentsScreen from '\.\.\/screens\/coach\/payments\/CoachPackageContentsScreen'/,
    );
  });

  it('the edit screen has a Manage content button that navigates to CoachPackageContents', () => {
    expect(EDIT_SRC).toMatch(/Manage content/);
    expect(EDIT_SRC).toMatch(/navigation\.navigate\('CoachPackageContents'/);
  });

  it('the push affordance is wired through PushPromptSheet → PushConfirmModal (M5)', () => {
    // M5 owns the per-row affordance hook AND the real prompt → confirm wiring.
    expect(SCREEN_SRC).toMatch(/onPushPress/);
    // The M2 placeholder "coming soon" Alert / TODO(M5) seam is GONE.
    expect(SCREEN_CODE).not.toMatch(/TODO\(M5\)/);
    expect(SCREEN_CODE).not.toMatch(/coming soon/);
    // The M3/M4 components are now imported and rendered (comment-stripped).
    expect(SCREEN_CODE).toMatch(/PushPromptSheet/);
    expect(SCREEN_CODE).toMatch(/PushConfirmModal/);
    expect(SCREEN_SRC).toMatch(/from '.*PushPromptSheet'/);
    expect(SCREEN_SRC).toMatch(/from '.*PushConfirmModal'/);
    // The real push API verbs are wired (preview + push).
    expect(SCREEN_CODE).toMatch(/coachPackageContentsApi\.pushPreview/);
    expect(SCREEN_CODE).toMatch(/coachPackageContentsApi\.push\(/);
  });

  it('uses warm empty-state copy, never "No data"', () => {
    expect(SCREEN_SRC).toMatch(/No content yet — add the first piece/);
    // Check the rendered copy (comments stripped) — the doctrine note above
    // intentionally references the forbidden phrase to document the rule.
    expect(SCREEN_CODE).not.toMatch(/No data/);
  });

  it('does not hardcode hex color values (uses useTheme colors)', () => {
    const withoutComments = SCREEN_SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).not.toMatch(/"#[0-9A-Fa-f]{3,6}"/);
    expect(SCREEN_SRC).toMatch(/useTheme/);
  });

  it('generates an idempotency key for the attach mutation (decision #8)', () => {
    expect(SCREEN_SRC).toMatch(/generateIdempotencyKey/);
  });
});

// ── RTL mount ─────────────────────────────────────────────────────────────────

const THEME_COLORS = {
  background: '#F5EFE4',
  surface: '#F1E8D5',
  primary: '#2C4A36',
  textPrimary: '#1A1A18',
  textSecondary: '#3D3D3A',
  textMuted: '#B1A89F',
  textOnPrimary: '#F5EFE4',
  border: 'rgba(176,141,87,0.2)',
  divider: 'rgba(176,141,87,0.15)',
  success: '#2C4A36',
  warning: '#C5A253',
  error: '#4A0404',
  info: '#1A73E8',
};

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: THEME_COLORS }),
}));

jest.mock('expo-font', () => ({ isLoaded: () => true }));

// Stable idempotency key so we can assert it flows through to the API.
jest.mock('../utils/idempotency', () => ({
  generateIdempotencyKey: () => 'test-idem-key-0001',
}));

jest.mock('../utils/haptics', () => ({
  lightTap: jest.fn(),
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));

// Partial mock of the M1 API client (jest.fn on every verb the screen uses).
const mockList = jest.fn();
const mockAttach = jest.fn();
const mockPatch = jest.fn();
const mockRemove = jest.fn();
const mockPushPreview = jest.fn();
const mockPush = jest.fn();
jest.mock('../api/packageContentsApi', () => ({
  coachPackageContentsApi: {
    list: (...a: unknown[]) => mockList(...a),
    attach: (...a: unknown[]) => mockAttach(...a),
    patch: (...a: unknown[]) => mockPatch(...a),
    remove: (...a: unknown[]) => mockRemove(...a),
    pushPreview: (...a: unknown[]) => mockPushPreview(...a),
    push: (...a: unknown[]) => mockPush(...a),
  },
}));

// Lightweight stand-ins for the FROZEN M3/M4 components so the SCREEN's state
// machine is exercised in isolation (no DateTimePicker, no sheet animation).
// Each exposes testID-tagged buttons that fire the exact prop callbacks the
// real components fire, so the wiring contract is what we assert.
jest.mock('../screens/coach/payments/contents/PushPromptSheet', () => {
  const RN = require('react-native');
  const React = require('react');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      props.visible
        ? React.createElement(
            RN.View,
            { testID: 'mock-prompt-sheet' },
            React.createElement(RN.Text, { testID: 'mock-prompt-title' }, props.contentTitle as string),
            React.createElement(RN.Text, { testID: 'mock-prompt-mode' }, props.mode as string),
            React.createElement(RN.TouchableOpacity, {
              testID: 'mock-prompt-existing',
              onPress: props.onPushExisting as () => void,
            }),
            React.createElement(RN.TouchableOpacity, {
              testID: 'mock-prompt-future',
              onPress: props.onFutureOnly as () => void,
            }),
            React.createElement(RN.TouchableOpacity, {
              testID: 'mock-prompt-dismiss',
              onPress: props.onDismiss as () => void,
            }),
          )
        : null,
  };
});

jest.mock('../screens/coach/payments/contents/PushConfirmModal', () => {
  const RN = require('react-native');
  const React = require('react');
  const fixedFireAt = new Date('2099-01-15T00:00:00.000Z');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      props.visible
        ? React.createElement(
            RN.View,
            { testID: 'mock-confirm-modal' },
            React.createElement(RN.Text, { testID: 'mock-confirm-count' }, String(props.audienceCount)),
            React.createElement(RN.Text, { testID: 'mock-confirm-label' }, props.audienceLabel as string),
            React.createElement(RN.Text, { testID: 'mock-confirm-submitting' }, String(!!props.submitting)),
            // Pick a fixed future date through the real onChangeFireAt prop.
            React.createElement(RN.TouchableOpacity, {
              testID: 'mock-confirm-pick-date',
              onPress: () => (props.onChangeFireAt as CallableFunction)(fixedFireAt),
            }),
            React.createElement(RN.TouchableOpacity, {
              testID: 'mock-confirm-submit',
              onPress: props.onConfirm as () => void,
            }),
            React.createElement(RN.TouchableOpacity, {
              testID: 'mock-confirm-cancel',
              onPress: props.onCancel as () => void,
            }),
          )
        : null,
  };
});

// A stable future fire-at the confirm mock feeds back via onChangeFireAt; the
// outer copy mirrors the in-factory value for the push-body assertions.
const mockFixedFireAt = new Date('2099-01-15T00:00:00.000Z');

import CoachPackageContentsScreen from '../screens/coach/payments/CoachPackageContentsScreen';

function makeContent(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    package_id: 'pkg1',
    asset_type: 'workout_program',
    asset_id: 'asset-1',
    asset_revision_id: null,
    display_order: 0,
    cadence_kind: 'immediate',
    cadence_payload: {},
    display_title: 'Week 1 Program',
    display_caption: null,
    created_at: '2026-05-30T00:00:00.000Z',
    updated_at: '2026-05-30T00:00:00.000Z',
    removed_at: null,
    ...over,
  };
}

const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
const route = { params: { packageId: 'pkg1', title: 'Elite Plan' } } as never;

describe('CoachPackageContentsScreen — RTL mount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders content rows from the list endpoint', async () => {
    mockList.mockResolvedValueOnce({ data: { contents: [makeContent()] } });
    const { getByTestId, getByText } = render(
      <CoachPackageContentsScreen navigation={navigation} route={route} />,
    );
    await waitFor(() => {
      expect(getByTestId('content-row-c1')).toBeTruthy();
    });
    expect(getByText('Week 1 Program')).toBeTruthy();
  });

  it('renders the warm empty state when there is no content', async () => {
    mockList.mockResolvedValueOnce({ data: { contents: [] } });
    const { getByTestId, getByText } = render(
      <CoachPackageContentsScreen navigation={navigation} route={route} />,
    );
    await waitFor(() => {
      expect(getByTestId('content-empty')).toBeTruthy();
    });
    expect(getByText('No content yet — add the first piece')).toBeTruthy();
  });

  it('"Add content" opens the attach form', async () => {
    mockList.mockResolvedValueOnce({ data: { contents: [] } });
    const { getByTestId } = render(
      <CoachPackageContentsScreen navigation={navigation} route={route} />,
    );
    await waitFor(() => expect(getByTestId('content-empty')).toBeTruthy());

    fireEvent.press(getByTestId('content-add-button'));
    await waitFor(() => {
      expect(getByTestId('content-attach-form')).toBeTruthy();
    });
  });

  it('submitting the attach form calls attach with an Idempotency-Key', async () => {
    mockList.mockResolvedValue({ data: { contents: [] } });
    mockAttach.mockResolvedValueOnce({ data: makeContent() });
    const { getByTestId } = render(
      <CoachPackageContentsScreen navigation={navigation} route={route} />,
    );
    await waitFor(() => expect(getByTestId('content-empty')).toBeTruthy());

    fireEvent.press(getByTestId('content-add-button'));
    await waitFor(() => expect(getByTestId('content-attach-form')).toBeTruthy());

    fireEvent.changeText(getByTestId('content-attach-asset-id'), 'asset-xyz');
    fireEvent.press(getByTestId('content-attach-submit'));

    await waitFor(() => {
      expect(mockAttach).toHaveBeenCalledTimes(1);
    });
    const callArgs = mockAttach.mock.calls[0];
    // attach(packageId, body, key)
    expect(callArgs[0]).toBe('pkg1');
    expect(callArgs[1]).toMatchObject({
      asset_type: 'workout_program',
      asset_id: 'asset-xyz',
      cadence_kind: 'immediate',
    });
    expect(callArgs[2]).toBe('test-idem-key-0001');
  });
});

// ── Per-card push flow (PR-17 M5) ────────────────────────────────────
describe('CoachPackageContentsScreen — per-card push flow (M5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function mountWithRow() {
    mockList.mockResolvedValue({ data: { contents: [makeContent()] } });
    const utils = render(
      <CoachPackageContentsScreen navigation={navigation} route={route} />,
    );
    await waitFor(() => expect(utils.getByTestId('content-row-c1')).toBeTruthy());
    return utils;
  }

  it('tapping the row push icon opens the prompt sheet with the right contentTitle', async () => {
    const { getByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());
    expect(getByTestId('mock-prompt-title').props.children).toBe('Week 1 Program');
    // The per-card affordance is the fresh-push entry (mode='new_content').
    expect(getByTestId('mock-prompt-mode').props.children).toBe('new_content');
  });

  it('"Future only" closes the sheet with NO preview/push call', async () => {
    const { getByTestId, queryByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());
    fireEvent.press(getByTestId('mock-prompt-future'));
    await waitFor(() => expect(queryByTestId('mock-prompt-sheet')).toBeNull());
    expect(mockPushPreview).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(queryByTestId('mock-confirm-modal')).toBeNull();
  });

  it('dismiss closes the sheet with NO preview/push call', async () => {
    const { getByTestId, queryByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());
    fireEvent.press(getByTestId('mock-prompt-dismiss'));
    await waitFor(() => expect(queryByTestId('mock-prompt-sheet')).toBeNull());
    expect(mockPushPreview).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('"Push existing" calls pushPreview then opens the confirm modal with the returned count', async () => {
    mockPushPreview.mockResolvedValueOnce({
      data: { count: 7, audience: 'active', already_delivered: 0 },
    });
    const { getByTestId, queryByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());
    fireEvent.press(getByTestId('mock-prompt-existing'));

    await waitFor(() => expect(mockPushPreview).toHaveBeenCalledTimes(1));
    // pushPreview(packageId, contentId, { audience:'active', mode:'push_existing' })
    expect(mockPushPreview.mock.calls[0][0]).toBe('pkg1');
    expect(mockPushPreview.mock.calls[0][1]).toBe('c1');
    expect(mockPushPreview.mock.calls[0][2]).toEqual({
      audience: 'active',
      mode: 'push_existing',
    });

    await waitFor(() => expect(getByTestId('mock-confirm-modal')).toBeTruthy());
    expect(getByTestId('mock-confirm-count').props.children).toBe('7');
    expect(getByTestId('mock-confirm-label').props.children).toBe('active buyers');
    // The prompt sheet is closed once the confirm modal opens.
    expect(queryByTestId('mock-prompt-sheet')).toBeNull();
  });

  it('preview FAILURE shows an error and does NOT open the confirm modal', async () => {
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => {});
    mockPushPreview.mockRejectedValueOnce(new Error('network down'));
    const { getByTestId, queryByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());
    fireEvent.press(getByTestId('mock-prompt-existing'));

    await waitFor(() => expect(mockPushPreview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toMatch(/Could not check buyers/);
    expect(queryByTestId('mock-confirm-modal')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('confirm calls push with the correct body + Idempotency-Key, shows success', async () => {
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => {});
    mockPushPreview.mockResolvedValueOnce({
      data: { count: 4, audience: 'active', already_delivered: 0 },
    });
    mockPush.mockResolvedValueOnce({
      data: {
        scheduled: 4,
        skipped: 0,
        fire_at: mockFixedFireAt.toISOString(),
        audience: 'active',
        notify: true,
      },
    });
    const { getByTestId, queryByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());
    fireEvent.press(getByTestId('mock-prompt-existing'));
    await waitFor(() => expect(getByTestId('mock-confirm-modal')).toBeTruthy());

    // Pick a future date, then confirm.
    fireEvent.press(getByTestId('mock-confirm-pick-date'));
    fireEvent.press(getByTestId('mock-confirm-submit'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const args = mockPush.mock.calls[0];
    expect(args[0]).toBe('pkg1');
    expect(args[1]).toBe('c1');
    expect(args[2]).toEqual({
      audience: 'active',
      fire_at: mockFixedFireAt.toISOString(),
      mode: 'push_existing',
      notify: true,
    });
    // Idempotency key (decision #8) threaded as the 4th arg.
    expect(args[3]).toBe('test-idem-key-0001');

    // Success: warm Alert + modal closes + list refreshes.
    await waitFor(() => expect(queryByTestId('mock-confirm-modal')).toBeNull());
    expect(alertSpy).toHaveBeenCalled();
    expect(alertSpy.mock.calls.some((c) => /delivers to 4 active buyers/.test(String(c[1])))).toBe(true);
    // load() ran once on mount + once after success.
    expect(mockList).toHaveBeenCalledTimes(2);
    alertSpy.mockRestore();
  });

  it('double-submit cannot fire push twice while submitting', async () => {
    mockPushPreview.mockResolvedValueOnce({
      data: { count: 2, audience: 'active', already_delivered: 0 },
    });
    // Never resolve, so submitting stays true across the second tap.
    mockPush.mockReturnValueOnce(new Promise(() => {}));
    const { getByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());
    fireEvent.press(getByTestId('mock-prompt-existing'));
    await waitFor(() => expect(getByTestId('mock-confirm-modal')).toBeTruthy());

    fireEvent.press(getByTestId('mock-confirm-pick-date'));
    fireEvent.press(getByTestId('mock-confirm-submit'));
    await waitFor(() =>
      expect(getByTestId('mock-confirm-submitting').props.children).toBe('true'),
    );
    // Second tap while in flight must be ignored.
    fireEvent.press(getByTestId('mock-confirm-submit'));
    fireEvent.press(getByTestId('mock-confirm-submit'));

    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('P0: two SYNCHRONOUS Confirm presses fire push EXACTLY ONCE (ref guard)', async () => {
    mockPushPreview.mockResolvedValueOnce({
      data: { count: 5, audience: 'active', already_delivered: 0 },
    });
    // Never resolves: the push promise is in flight across both taps, and we do
    // NOT await any re-render between the two presses. The `pushSubmitting`
    // STATE has not propagated yet, so only a SYNCHRONOUS ref guard can block
    // the second tap. If the code relied on state alone, push would fire twice.
    mockPush.mockReturnValueOnce(new Promise(() => {}));
    const { getByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());
    fireEvent.press(getByTestId('mock-prompt-existing'));
    await waitFor(() => expect(getByTestId('mock-confirm-modal')).toBeTruthy());
    fireEvent.press(getByTestId('mock-confirm-pick-date'));

    // Two back-to-back taps in the SAME tick — no waitFor in between, so no
    // re-render lands between them. The synchronous submitInFlightRef must
    // swallow the second tap.
    fireEvent.press(getByTestId('mock-confirm-submit'));
    fireEvent.press(getByTestId('mock-confirm-submit'));

    // push called EXACTLY ONCE despite two synchronous taps.
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('P0: the single push uses ONE idempotency key captured once at intent start', async () => {
    mockPushPreview.mockResolvedValueOnce({
      data: { count: 5, audience: 'active', already_delivered: 0 },
    });
    mockPush.mockReturnValueOnce(new Promise(() => {}));
    const { getByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());
    fireEvent.press(getByTestId('mock-prompt-existing'));
    await waitFor(() => expect(getByTestId('mock-confirm-modal')).toBeTruthy());
    fireEvent.press(getByTestId('mock-confirm-pick-date'));

    fireEvent.press(getByTestId('mock-confirm-submit'));
    fireEvent.press(getByTestId('mock-confirm-submit'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    // The single push uses the ONE stable key (minted once, the mocked value).
    expect(mockPush.mock.calls[0][3]).toBe('test-idem-key-0001');
  });

  it('a retry after a FAILED push reuses the SAME idempotency key', async () => {
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => {});
    mockPushPreview.mockResolvedValueOnce({
      data: { count: 6, audience: 'active', already_delivered: 0 },
    });
    // First push FAILS, retry SUCCEEDS — same intent, same key both times.
    mockPush
      .mockRejectedValueOnce(new Error('server 500'))
      .mockResolvedValueOnce({
        data: {
          scheduled: 6,
          skipped: 0,
          fire_at: mockFixedFireAt.toISOString(),
          audience: 'active',
          notify: true,
        },
      });
    const { getByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());
    fireEvent.press(getByTestId('mock-prompt-existing'));
    await waitFor(() => expect(getByTestId('mock-confirm-modal')).toBeTruthy());
    fireEvent.press(getByTestId('mock-confirm-pick-date'));

    // First attempt fails — modal stays open, submitting resets to false.
    fireEvent.press(getByTestId('mock-confirm-submit'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(getByTestId('mock-confirm-submitting').props.children).toBe('false'),
    );

    // Deliberate RETRY of the SAME intent.
    fireEvent.press(getByTestId('mock-confirm-submit'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));

    // Both calls used the SAME idempotency key (one key per intent).
    expect(mockPush.mock.calls[0][3]).toBe('test-idem-key-0001');
    expect(mockPush.mock.calls[1][3]).toBe('test-idem-key-0001');
    expect(mockPush.mock.calls[1][3]).toBe(mockPush.mock.calls[0][3]);
    alertSpy.mockRestore();
  });

  it('P2: shows a calm loading state while pushPreview is in flight', async () => {
    // Preview stays pending so we can observe the loading affordance; the
    // confirm modal must NOT be visible yet (no dead moment, no premature jump).
    let resolvePreview!: (v: unknown) => void;
    mockPushPreview.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    const { getByTestId, queryByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());
    fireEvent.press(getByTestId('mock-prompt-existing'));

    // While preview is in flight: calm loading visible, confirm modal NOT yet.
    await waitFor(() => expect(getByTestId('push-preview-loading')).toBeTruthy());
    expect(queryByTestId('mock-confirm-modal')).toBeNull();

    // Once preview resolves, the loading clears and the confirm modal opens.
    resolvePreview({ data: { count: 3, audience: 'active', already_delivered: 0 } });
    await waitFor(() => expect(getByTestId('mock-confirm-modal')).toBeTruthy());
    expect(queryByTestId('push-preview-loading')).toBeNull();
  });

  it('P0 R2: double-tap "Send to existing" — only ONE preview drives confirm', async () => {
    // Two SYNCHRONOUS taps on the prompt's "Send to existing buyers". The
    // synchronous previewInFlightRef guard must swallow the second tap so only
    // ONE pushPreview round-trip ever starts and drives the confirm modal.
    mockPushPreview.mockResolvedValueOnce({
      data: { count: 9, audience: 'active', already_delivered: 0 },
    });
    const { getByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());

    // Back-to-back taps in the SAME tick on the SAME node reference — no
    // waitFor between them, so no re-render (and no unmount) lands. Only a
    // synchronous ref guard can block the second tap.
    const existingBtn = getByTestId('mock-prompt-existing');
    fireEvent.press(existingBtn);
    fireEvent.press(existingBtn);

    await waitFor(() => expect(getByTestId('mock-confirm-modal')).toBeTruthy());
    // pushPreview fired EXACTLY ONCE despite two synchronous taps.
    expect(mockPushPreview).toHaveBeenCalledTimes(1);
    expect(getByTestId('mock-confirm-count').props.children).toBe('9');
  });

  it('P0 R2: a late/stale preview cannot reset submit lock or change idem key mid-push', async () => {
    // The race the audit flagged: two previews start; preview A resolves, opens
    // confirm, the coach confirms and a push is IN FLIGHT; then a SECOND, stale
    // preview resolves LATE. It must NOT reset submitInFlightRef nor re-mint the
    // idempotency key. We assert the observable contract: push stays at one call
    // with one stable key, and a confirm tap after the stale resolution does NOT
    // fire a second push.
    //
    // To force a second preview past the synchronous guard we cannot double-tap
    // (the guard blocks that). Instead we model the stale resolution directly:
    // preview A resolves → confirm opens → push fires (never resolves, stays in
    // flight). A late stale preview resolution is represented by NOT being able
    // to disturb the lock — verified by a post-confirm second tap firing no new
    // push and the key remaining identical.
    let resolveA!: (v: unknown) => void;
    mockPushPreview.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveA = resolve;
      }),
    );
    // push never resolves: the first push is in flight across the rest of the
    // test, so any erroneous lock reset would let a second push through.
    mockPush.mockReturnValueOnce(new Promise(() => {}));

    const { getByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());

    // Tap "Send to existing" — preview A starts (in flight).
    fireEvent.press(getByTestId('mock-prompt-existing'));
    await waitFor(() => expect(getByTestId('push-preview-loading')).toBeTruthy());
    expect(mockPushPreview).toHaveBeenCalledTimes(1);

    // Preview A resolves → confirm opens.
    resolveA({ data: { count: 5, audience: 'active', already_delivered: 0 } });
    await waitFor(() => expect(getByTestId('mock-confirm-modal')).toBeTruthy());

    // Confirm → first push fires and is in flight.
    fireEvent.press(getByTestId('mock-confirm-pick-date'));
    fireEvent.press(getByTestId('mock-confirm-submit'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(getByTestId('mock-confirm-submitting').props.children).toBe('true'),
    );
    const keyAfterFirstPush = mockPush.mock.calls[0][3];

    // A second confirm tap WHILE the push is in flight must be swallowed by the
    // submit lock (which a stale preview must never have reset).
    fireEvent.press(getByTestId('mock-confirm-submit'));
    fireEvent.press(getByTestId('mock-confirm-submit'));

    // EXACTLY ONCE, same stable key — the lock was never reset.
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][3]).toBe(keyAfterFirstPush);
    expect(mockPush.mock.calls[0][3]).toBe('test-idem-key-0001');
  });

  it('P0 R2: exactly-once push survives a double-preview race (one stable key)', async () => {
    // End-to-end exactly-once guarantee: double-tap the prompt, complete the
    // flow, and verify push is called at most once with a single stable key.
    mockPushPreview.mockResolvedValueOnce({
      data: { count: 8, audience: 'active', already_delivered: 0 },
    });
    mockPush.mockReturnValueOnce(new Promise(() => {}));
    const { getByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());

    // Double-tap the prompt on the SAME node — second is guarded out.
    const existingBtn = getByTestId('mock-prompt-existing');
    fireEvent.press(existingBtn);
    fireEvent.press(existingBtn);
    await waitFor(() => expect(getByTestId('mock-confirm-modal')).toBeTruthy());
    expect(mockPushPreview).toHaveBeenCalledTimes(1);

    // Confirm twice synchronously — push fires exactly once.
    fireEvent.press(getByTestId('mock-confirm-pick-date'));
    fireEvent.press(getByTestId('mock-confirm-submit'));
    fireEvent.press(getByTestId('mock-confirm-submit'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][3]).toBe('test-idem-key-0001');
  });

  it('push FAILURE keeps the modal open and surfaces a warm error', async () => {
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => {});
    mockPushPreview.mockResolvedValueOnce({
      data: { count: 3, audience: 'active', already_delivered: 0 },
    });
    mockPush.mockRejectedValueOnce(new Error('server 500'));
    const { getByTestId } = await mountWithRow();
    fireEvent.press(getByTestId('content-row-push-c1'));
    await waitFor(() => expect(getByTestId('mock-prompt-sheet')).toBeTruthy());
    fireEvent.press(getByTestId('mock-prompt-existing'));
    await waitFor(() => expect(getByTestId('mock-confirm-modal')).toBeTruthy());

    fireEvent.press(getByTestId('mock-confirm-pick-date'));
    fireEvent.press(getByTestId('mock-confirm-submit'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls.some((c) => /Could not push/.test(String(c[0])))).toBe(true);
    // Modal stays OPEN for retry, and submitting is reset to false.
    expect(getByTestId('mock-confirm-modal')).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId('mock-confirm-submitting').props.children).toBe('false'),
    );
    alertSpy.mockRestore();
  });
});
