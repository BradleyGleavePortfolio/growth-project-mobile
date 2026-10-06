/**
 * OR-110-2: the dunning email link and the in-app blocker deep link open the
 * native Update card screen.
 *
 *   https://app.trygrowthproject.com/billing/update-card   (emails, universal link)
 *   tgp://billing/update-card                              (landing page button)
 *   tgp://billing/update                                   (backend blocker deep_link)
 *
 * React Navigation strips the prefix before getStateFromPath, so the
 * post-prefix path is driven through the exported linking config.
 */

jest.mock('../screenshots', () => ({ isScreenshotMode: () => false }));
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn() }),
  VideoView: () => null,
}));
jest.mock('../navigation/AuthNavigator', () => () => null);
jest.mock('../navigation/ClientNavigator', () => () => null);
jest.mock('../navigation/CoachNavigator', () => () => null);
jest.mock('../navigation/OnboardingNavigator', () => () => null);
jest.mock('../navigation/LeanOnboardingNavigator', () => () => null);

import { linking } from '../navigation/RootNavigator';

function findRoute(state: unknown, name: string): Record<string, unknown> | null {
  const stack: unknown[] = [state];
  while (stack.length) {
    const node = stack.pop() as { routes?: Array<Record<string, unknown>> } | null;
    if (!node?.routes) continue;
    for (const route of node.routes) {
      if (route.name === name) return route;
      if (route.state) stack.push(route.state);
    }
  }
  return null;
}

describe('RootNavigator linking — native Update card', () => {
  const opts = () => ({ screens: linking.config!.screens });

  it('keeps the universal-link host and the tgp scheme as prefixes', () => {
    expect(linking.prefixes).toEqual(expect.arrayContaining(['tgp://', 'https://app.trygrowthproject.com']));
  });

  it.each(['billing/update-card', 'billing/update', '/billing/update-card'])('%s opens UpdateCard under MoreTab', (path) => {
    const state = linking.getStateFromPath!(path, opts());
    const more = findRoute(state, 'MoreTab');
    expect(more).toBeTruthy();
    expect(findRoute(state, 'UpdateCard')).toBeTruthy();
  });

  it('does not swallow neighbouring billing paths', () => {
    const state = linking.getStateFromPath!('billing/history', opts());
    expect(findRoute(state, 'UpdateCard')).toBeNull();
  });
});
