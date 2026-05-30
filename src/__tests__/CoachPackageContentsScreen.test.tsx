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

  it('the push affordance is a placeholder seam, not the push modal (M3/M4 are out of scope)', () => {
    // M2 owns the per-row affordance + an onPushPress hook only.
    expect(SCREEN_SRC).toMatch(/onPushPress/);
    expect(SCREEN_SRC).toMatch(/TODO\(M5\)/);
    // Forbidden: M2 must NOT build the push prompt / confirm modal. Check the
    // CODE (comments stripped) so the doctrine note referencing the M3/M4 file
    // names doesn't trip the guard.
    expect(SCREEN_CODE).not.toMatch(/PushPromptSheet/);
    expect(SCREEN_CODE).not.toMatch(/PushConfirmModal/);
    // No imports of the M3/M4 files anywhere.
    expect(SCREEN_SRC).not.toMatch(/from '.*PushPromptSheet'/);
    expect(SCREEN_SRC).not.toMatch(/from '.*PushConfirmModal'/);
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

// Partial mock of the M1 API client (jest.fn on list/attach/patch/remove).
const mockList = jest.fn();
const mockAttach = jest.fn();
const mockPatch = jest.fn();
const mockRemove = jest.fn();
jest.mock('../api/packageContentsApi', () => ({
  coachPackageContentsApi: {
    list: (...a: unknown[]) => mockList(...a),
    attach: (...a: unknown[]) => mockAttach(...a),
    patch: (...a: unknown[]) => mockPatch(...a),
    remove: (...a: unknown[]) => mockRemove(...a),
  },
}));

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
