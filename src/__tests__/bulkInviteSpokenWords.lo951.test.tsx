/**
 * LO-951 B-TEST (lens, agent 201): owner rule 137-2 on m#951. Every spoken label on the one
 * invite screen must already exist, word for word, on BulkInvite or CoachBulkInvite at base
 * 6c90758f (or be W12). The list below is every accessibilityLabel and visible label those two
 * screens had at base. Fails at b2a2ad5f: the shared Masthead back control speaks "Back".
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
const mockBulkInvite = jest.fn();
jest.mock('../api/invites', () => {
  const actual = jest.requireActual('../api/invites');
  return { ...actual, invitesApi: { bulkInvite: (...a: unknown[]) => mockBulkInvite(...a) } };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (e: () => void) => jest.requireActual('react').useEffect(e, [e]),
}));

import BulkInviteScreen from '../screens/coach/BulkInviteScreen';

// At base: BulkInviteScreen.tsx:229,248,271,290,341,363,403,412 and visible "Invite clients by email",
// "Paste", "Upload CSV"; CoachBulkInviteScreen.tsx:131,144,158,243.
const BASE = new Set([
  'Invite clients by email', 'Paste', 'Upload CSV', 'Paste emails', 'Pick CSV file', 'Optional message',
  'Copy failed emails', 'Retry failed emails', 'Preview', 'Send invites', 'Retry rejected',
]);
const onBase = (s: string) => BASE.has(s) || /^Send \d+ invites$/.test(s);

type Node = { props?: Record<string, unknown>; children?: (Node | string)[] | null };
function spoken(tree: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as Node;
    if (typeof node.props?.accessibilityLabel === 'string') out.push(node.props.accessibilityLabel as string);
    (node.children ?? []).forEach(walk);
  };
  walk(tree);
  return out;
}

describe('LO-951 m#951 words (owner rule 137-2)', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });

  it('every spoken label on the invite screen exists at base (owner rule 137-2)', async () => {
    mockBulkInvite.mockResolvedValueOnce({ results: [
      { email: 'a@ex.com', status: 'created', emailQueued: true, inviteId: 'i1' },
      { email: 'b@ex.com', status: 'failed', emailQueued: false, error: 'x' },
    ] });
    const screen = await render(<BulkInviteScreen />);
    const seen = new Set(spoken(screen.toJSON()));
    await fireEvent.changeText(screen.getByTestId('bulk-paste-input'), 'a@ex.com, Alice\nb@ex.com');
    spoken(screen.toJSON()).forEach((s) => seen.add(s));
    await fireEvent.press(screen.getByTestId('bulk-submit'));
    await waitFor(() => expect(screen.getByTestId('bulk-results')).toBeTruthy());
    spoken(screen.toJSON()).forEach((s) => seen.add(s));
    expect([...seen].filter((s) => !onBase(s))).toEqual([]);
  });
});
