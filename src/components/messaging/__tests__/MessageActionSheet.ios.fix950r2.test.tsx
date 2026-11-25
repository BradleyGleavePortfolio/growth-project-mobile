/**
 * FIX-950R2 (agent 202, LS-950R2 B1): the iOS branch of the shared message menu (Roman and both
 * direct-message screens). ActionSheetIOS keeps its choice callback outside React until a tap or
 * dismissActionSheet, so the test holds on to it as the native side does. One shown sheet lives
 * as long as the open it was shown for: hidden, unmounted or a sign-in change dismisses it and
 * its old Reply, Copy and Report run nothing. A choice made while it is open works as before.
 */
import React from 'react';
import { ActionSheetIOS, Platform } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { MessageActionSheet } from '../MessageActionSheet';

const { authEvents } = require('../../../utils/authEvents');

const realOS = Platform.OS;
beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS }));

type Shown = { options: string[]; title?: string; choose: (index: number) => void };
let shown: Shown[];
let dismiss: jest.SpyInstance;
let h: { onReply: jest.Mock; onCopy: jest.Mock; onReport: jest.Mock; onClose: jest.Mock };
beforeEach(() => {
  shown = [];
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((o, cb) => {
    shown.push({ options: o.options as string[], title: o.title as string | undefined, choose: cb });
  });
  dismiss = jest.spyOn(ActionSheetIOS, 'dismissActionSheet').mockImplementation(() => undefined);
  h = { onReply: jest.fn(), onCopy: jest.fn(), onReport: jest.fn(), onClose: jest.fn() };
});
afterEach(() => jest.restoreAllMocks());

const Sheet = ({ visible, canReply }: { visible: boolean; canReply?: boolean }) => (
  <MessageActionSheet visible={visible} messagePreview="hello there" canReply={canReply} {...h} />
);
type R = Awaited<ReturnType<typeof render>>;
const choose = async (menu: Shown, label: string) => {
  await act(async () => { menu.choose(menu.options.indexOf(label)); });
};

const ENDS: Array<[string, (r: R) => Promise<void>, number]> = [
  ['visible turns false', async (r) => { await r.rerender(<Sheet visible={false} />); }, 0],
  ['it unmounts', async (r) => { await r.unmount(); }, 0],
  // Sign-out and session expiry (authEvents 'logout') and another sign-in: the parent is told it closed.
  ['sign-out or session expiry', async () => { await act(async () => { authEvents.emit('logout'); }); }, 1],
  ['another sign-in', async () => { await act(async () => { authEvents.emit('login'); }); }, 1],
];

describe.each(ENDS)('FIX-950R2 MessageActionSheet iOS: %s', (_name, end, closes) => {
  it.each(['Reply', 'Copy', 'Report Message'])('dismisses the native sheet once; the old %s runs nothing', async (label) => {
    const r = await render(<Sheet visible />);
    expect(shown).toHaveLength(1);
    await end(r);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(h.onClose).toHaveBeenCalledTimes(closes);
    await choose(shown[0], label);
    expect(h.onReply).not.toHaveBeenCalled();
    expect(h.onCopy).not.toHaveBeenCalled();
    expect(h.onReport).not.toHaveBeenCalled();
    expect(h.onClose).toHaveBeenCalledTimes(closes);
  });
});

describe('FIX-950R2 MessageActionSheet iOS: a choice while open works as before (positive controls)', () => {
  it.each([
    ['Reply', 'onReply'], ['Copy', 'onCopy'], ['Report Message', 'onReport'],
  ] as const)('Roman shape: %s closes the menu, then runs %s once; hiding after it dismisses nothing', async (label, key) => {
    const r = await render(<Sheet visible />);
    expect(shown[0].options).toEqual(['Reply', 'Copy', 'Report Message', 'Cancel']);
    expect(shown[0].title).toBe('hello there');
    await choose(shown[0], label);
    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(h[key]).toHaveBeenCalledTimes(1);
    await r.rerender(<Sheet visible={false} />);
    expect(dismiss).not.toHaveBeenCalled();
    await choose(shown[0], label);
    expect(h[key]).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Copy', 'onCopy'], ['Report Message', 'onReport'],
  ] as const)('direct-message shape (no Reply): %s runs %s once', async (label, key) => {
    await render(<Sheet visible canReply={false} />);
    expect(shown[0].options).toEqual(['Copy', 'Report Message', 'Cancel']);
    await choose(shown[0], label);
    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(h[key]).toHaveBeenCalledTimes(1);
    expect(h.onReply).not.toHaveBeenCalled();
  });

  it('Cancel only closes; the next open shows a new sheet that works', async () => {
    const r = await render(<Sheet visible />);
    await choose(shown[0], 'Cancel');
    expect(h.onClose).toHaveBeenCalledTimes(1);
    await r.rerender(<Sheet visible={false} />);
    await r.rerender(<Sheet visible />);
    expect(shown).toHaveLength(2);
    await choose(shown[1], 'Copy');
    expect(h.onCopy).toHaveBeenCalledTimes(1);
    expect(dismiss).not.toHaveBeenCalled();
  });
});
