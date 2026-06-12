/**
 * Roman P1 #238 — R3 UX accessibility regression tests.
 *
 * Closes the four R3 UX audit findings against silent regression:
 *
 *   - P1-1  Loading states expose busy/progressbar semantics (initial skeleton
 *           + "load older" footer) instead of a silent placeholder.
 *   - P1-2  Error / rollback announcements are live regions AND fire an explicit
 *           `AccessibilityInfo.announceForAccessibility` (send-error inline row
 *           + full-screen RomanState).
 *   - P1-3  Chat thread + entry-list surfaces carry list / listitem roles.
 *   - P2-1  Reduced motion gates the chat auto-scroll and the skeleton pulse.
 *
 * Strategy: component-level render tests for the self-contained pieces
 * (RomanState, RomanMessageBubble), and source-contract guards for the screen
 * wiring (RomanChatScreen, MoreScreen, SettingsScreen, Skeleton) — mirroring the
 * repo's existing `skeleton.test.tsx` contract-guard approach, which avoids
 * mounting the full chat state machine + navigator while still pinning the
 * exact a11y attributes the audit requires.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render } from '@testing-library/react-native';

import RomanState from '../../../components/roman/RomanState';
import RomanMessageBubble from '../../../components/roman/RomanMessageBubble';
import type { RomanMessage } from '../../../api/romanApi';
import {
  ROMAN_LOADING_A11Y_LABEL,
  ROMAN_OFFLINE_TITLE,
  ROMAN_UNAVAILABLE_TITLE,
} from '../../../components/roman/romanVoice';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function readSrc(...segments: string[]): string {
  return fs.readFileSync(path.join(ROOT, 'src', ...segments), 'utf8');
}

const CHAT_SRC = readSrc('screens', 'roman', 'RomanChatScreen.tsx');
const SKELETON_SRC = readSrc('ui', 'skeletons', 'Skeleton.tsx');
const MORE_SRC = readSrc('screens', 'client', 'MoreScreen.tsx');
const SETTINGS_SRC = readSrc('screens', 'coach', 'SettingsScreen.tsx');

// ─── P1-2 — RomanState full-screen failures are announced live regions ────────

describe('RomanState — error/offline/unavailable are live regions (R3 P1-2)', () => {
  let announce: jest.SpyInstance;

  beforeEach(() => {
    announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    announce.mockRestore();
  });

  it('an error state is an assertive alert and announces its copy', () => {
    const { getByTestId } = render(<RomanState kind="error" testID="state" />);
    const node = getByTestId('state');
    expect(node.props.accessibilityRole).toBe('alert');
    expect(node.props.accessibilityLiveRegion).toBe('assertive');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0][0]).toContain('That request did not complete');
  });

  it('an offline state is assertive and announces title + body', () => {
    const { getByTestId } = render(<RomanState kind="offline" testID="state" />);
    const node = getByTestId('state');
    expect(node.props.accessibilityLiveRegion).toBe('assertive');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0][0]).toContain(ROMAN_OFFLINE_TITLE);
  });

  it('the calm unavailable state announces politely (non-actionable)', () => {
    const { getByTestId } = render(
      <RomanState kind="unavailable" testID="state" />,
    );
    const node = getByTestId('state');
    expect(node.props.accessibilityRole).toBe('alert');
    expect(node.props.accessibilityLiveRegion).toBe('polite');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0][0]).toContain(ROMAN_UNAVAILABLE_TITLE);
  });
});

// ─── P1-3 — message rows are list items ───────────────────────────────────────

describe('RomanMessageBubble — rows are list items (R3 P1-3)', () => {
  function makeMessage(role: 'assistant' | 'user'): RomanMessage {
    return {
      id: `m-${role}`,
      role,
      content: role === 'assistant' ? 'At your service.' : 'Hello.',
      interrupted: false,
      createdAt: new Date().toISOString(),
    };
  }

  it('an assistant row exposes role="listitem"', () => {
    const { getByTestId } = render(
      <RomanMessageBubble message={makeMessage('assistant')} testID="row" />,
    );
    expect(getByTestId('row').props.role).toBe('listitem');
  });

  it('a user row exposes role="listitem"', () => {
    const { getByTestId } = render(
      <RomanMessageBubble message={makeMessage('user')} testID="row" />,
    );
    expect(getByTestId('row').props.role).toBe('listitem');
  });
});

// ─── P1-1 — RomanChatScreen loading states carry busy/progress semantics ──────

describe('RomanChatScreen — loading states are busy progressbars (R3 P1-1)', () => {
  it('the initial LoadingSkeleton wrapper is a busy progressbar with a label', () => {
    expect(CHAT_SRC).toMatch(/accessibilityRole="progressbar"/);
    expect(CHAT_SRC).toMatch(/accessibilityLabel=\{ROMAN_LOADING_A11Y_LABEL\}/);
    expect(CHAT_SRC).toMatch(/accessibilityState=\{\{\s*busy:\s*true\s*\}\}/);
  });

  it('the loading-older footer is a busy progressbar live region', () => {
    // Footer block carries label = the Roman-voiced "gathering" line.
    expect(CHAT_SRC).toMatch(/accessibilityLabel=\{ROMAN_LOADING_OLDER\}/);
    // At least two busy progressbars exist (initial + footer).
    const busyCount = (CHAT_SRC.match(/busy:\s*true/g) ?? []).length;
    expect(busyCount).toBeGreaterThanOrEqual(2);
  });

  it('exposes a Roman-voiced loading label rather than a generic string', () => {
    expect(ROMAN_LOADING_A11Y_LABEL.length).toBeGreaterThan(0);
    expect(ROMAN_LOADING_A11Y_LABEL).not.toMatch(/loading\.\.\./i);
  });
});

// ─── P1-2 — RomanChatScreen send-error is a live region + announced ───────────

describe('RomanChatScreen — send error is an announced live region (R3 P1-2)', () => {
  it('the inline send-error row is an assertive alert', () => {
    const errorBlock = CHAT_SRC.slice(CHAT_SRC.indexOf('roman-send-error'));
    expect(errorBlock).toMatch(/accessibilityRole="alert"/);
    expect(errorBlock).toMatch(/accessibilityLiveRegion="assertive"/);
  });

  it('an effect announces the send-error copy via announceForAccessibility', () => {
    expect(CHAT_SRC).toMatch(/announceForAccessibility\(sendErrorCopy\)/);
    // Deduped so a re-render does not repeat the same failure announcement.
    expect(CHAT_SRC).toMatch(/lastAnnouncedError/);
  });
});

// ─── P1-3 — list semantics on chat + entry-list surfaces ──────────────────────

describe('list / listitem semantics across Roman surfaces (R3 P1-3)', () => {
  it('the chat FlatList is a list container', () => {
    // The FlatList block spans from <FlatList to its testID="roman-message-list".
    const open = CHAT_SRC.indexOf('<FlatList');
    const close = CHAT_SRC.indexOf('roman-message-list', open);
    const flatListBlock = CHAT_SRC.slice(open, close);
    expect(flatListBlock).toMatch(/role="list"/);
  });

  it('the client More menu is a list of listitems including Roman', () => {
    expect(MORE_SRC).toMatch(/role="list"/);
    expect(MORE_SRC).toMatch(/role="listitem"/);
    // Roman entry still present in the same collection.
    expect(MORE_SRC).toMatch(/client-roman-entry-avatar/);
  });

  it('the coach Concierge section is a list with a Roman listitem', () => {
    const concierge = SETTINGS_SRC.slice(SETTINGS_SRC.indexOf('Concierge'));
    expect(concierge).toMatch(/role="list"/);
    expect(concierge).toMatch(/role="listitem"/);
    expect(concierge).toMatch(/coach-roman-entry-avatar/);
  });
});

// ─── P2-1 — reduced motion gates auto-scroll + skeleton pulse ─────────────────

describe('reduced motion parity (R3 P2-1)', () => {
  it('RomanChatScreen scroll respects the reduce-motion preference', () => {
    expect(CHAT_SRC).toMatch(/isReduceMotionEnabled\(\)/);
    expect(CHAT_SRC).toMatch(/scrollToEnd\(\{\s*animated:\s*!reduceMotion\s*\}\)/);
    // The probe failure is logged, never silently swallowed (Bradley #36).
    expect(CHAT_SRC).toMatch(/logger\.warn\('RomanChatScreen\.reduceMotionQuery'/);
  });

  it('Skeleton holds a static opacity under reduce motion instead of pulsing', () => {
    expect(SKELETON_SRC).toMatch(/isReduceMotionEnabled\(\)/);
    expect(SKELETON_SRC).toMatch(/if\s*\(reduceMotion\)/);
    // The looping pulse is still the default (motion-on) path.
    expect(SKELETON_SRC).toMatch(/withRepeat/);
    expect(SKELETON_SRC).toMatch(/logger\.warn\('Skeleton\.reduceMotionQuery'/);
  });
});
