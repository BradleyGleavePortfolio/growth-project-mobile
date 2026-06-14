/**
 * useWearablePrompts — hook behaviour tests for the v3-4 COACH-ONLY wearable
 * coaching prompts surface.
 *
 * Verifies the query + mutation posture (mirrors the v3-4 useCommunitySearch
 * harness and the v3-3 voice-upload mutation harness):
 *   - DISABLED (no fetch) when no workspace id is known — the surface must
 *     never issue an unbounded read before a workspace is resolved.
 *   - ENABLED with a workspace id: calls list(workspaceId, { clientId,
 *     includeDismissed }) and surfaces the validated prompt list.
 *   - Mutations (generate / dismiss / act-on) call the matching api method and
 *     invalidate the prompts list so the surface reconciles with the server.
 *
 * L8 learnings encoded here:
 *   - AsyncStorage is never `require()`d (no AsyncStorage usage in this hook —
 *     but the default-import discipline is preserved repo-wide via jest.setup).
 *   - TanStack Query v5 + RNTL v14: post-`mutateAsync` the resolved value lands
 *     on the NEXT microtask flush, so any assertion that reads back through the
 *     query cache is wrapped in `await waitFor(() => ...)`.
 *
 * communityWearablePromptsApi is mocked so the tests are deterministic and
 * never touch the network.
 */
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../api/communityWearablePromptsApi', () => ({
  communityWearablePromptsApi: {
    list: jest.fn(),
    generate: jest.fn(),
    dismiss: jest.fn(),
    actOn: jest.fn(),
  },
  WEARABLE_PROMPTS_PAGE_LIMIT: 50,
}));

import { communityWearablePromptsApi } from '../../api/communityWearablePromptsApi';
import type {
  GenerateResponse,
  PromptListResponse,
  PromptView,
} from '../../api/communityWearablePromptsApi';
import {
  useWearablePrompts,
  useGenerateWearablePrompts,
  useDismissWearablePrompt,
  useActOnWearablePrompt,
  wearablePromptsKeys,
} from '../useWearablePrompts';

const api = jest.mocked(communityWearablePromptsApi);

const WS = '11111111-1111-4111-8111-111111111111';
const COACH = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';

function prompt(overrides: Partial<PromptView> = {}): PromptView {
  return {
    id: 'prompt-1',
    workspaceId: WS,
    coachId: COACH,
    clientId: CLIENT,
    metricKey: 'HRV_MS',
    promptText: 'Their HRV trended up this week — worth a check-in.',
    sources: [{ sampleId: 'sample-1', metricKey: 'HRV_MS', observedValue: 62 }],
    generatedAt: '2026-03-01T00:00:00.000Z',
    dismissedAt: null,
    actedOnAt: null,
    ...overrides,
  };
}

function list(prompts: PromptView[]): PromptListResponse {
  return { version: 1, prompts };
}

function generateResponse(
  generated: PromptView[],
  skipped: GenerateResponse['skipped'] = [],
): GenerateResponse {
  return { version: 1, generated, skipped };
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

beforeEach(() => {
  (api.list as jest.Mock).mockReset();
  (api.generate as jest.Mock).mockReset();
  (api.dismiss as jest.Mock).mockReset();
  (api.actOn as jest.Mock).mockReset();
  api.list.mockResolvedValue(list([]));
});

describe('useWearablePrompts — disabled posture (no network)', () => {
  it('does NOT fetch when no workspace id is known', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useWearablePrompts({ workspaceId: undefined, clientId: CLIENT }),
      { wrapper: Wrapper },
    );
    expect(api.list).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useWearablePrompts — enabled list read', () => {
  it('lists active prompts for the workspace + client (no dismissed by default)', async () => {
    api.list.mockResolvedValue(list([prompt()]));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useWearablePrompts({ workspaceId: WS, clientId: CLIENT }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.list).toHaveBeenLastCalledWith(WS, {
      clientId: CLIENT,
      includeDismissed: undefined,
    });
    expect(result.current.data?.prompts).toHaveLength(1);
    expect(result.current.data?.prompts[0].id).toBe('prompt-1');
  });

  it('threads includeDismissed through when requested', async () => {
    api.list.mockResolvedValue(list([]));
    const { Wrapper } = makeWrapper();
    renderHook(
      () =>
        useWearablePrompts({
          workspaceId: WS,
          clientId: CLIENT,
          includeDismissed: true,
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith(WS, {
        clientId: CLIENT,
        includeDismissed: true,
      }),
    );
  });
});

describe('useGenerateWearablePrompts — mutation invalidates the list', () => {
  it('calls generate with the input and invalidates the prompts list', async () => {
    api.generate.mockResolvedValue(generateResponse([prompt({ id: 'gen-1' })]));
    const { qc, Wrapper } = makeWrapper();
    const invalidate = jest.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(
      () => useGenerateWearablePrompts(WS),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({ clientId: CLIENT, metricKey: 'HRV_MS' });
    });

    expect(api.generate).toHaveBeenCalledWith(WS, {
      clientId: CLIENT,
      metricKey: 'HRV_MS',
    });
    // v5 + RNTL v14: the resolved data lands on the next flush.
    await waitFor(() =>
      expect(result.current.data?.generated[0].id).toBe('gen-1'),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: wearablePromptsKeys.all,
    });
  });

  it('surfaces a skipped reason from the generate response', async () => {
    api.generate.mockResolvedValue(
      generateResponse([], [{ metricKey: 'RECOVERY_SCORE', reason: 'cooldown' }]),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useGenerateWearablePrompts(WS),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({ clientId: CLIENT });
    });

    await waitFor(() =>
      expect(result.current.data?.skipped[0]).toEqual({
        metricKey: 'RECOVERY_SCORE',
        reason: 'cooldown',
      }),
    );
  });
});

describe('useDismissWearablePrompt — mutation invalidates the list', () => {
  it('calls dismiss with the prompt id and invalidates the list', async () => {
    api.dismiss.mockResolvedValue(
      prompt({ id: 'prompt-1', dismissedAt: '2026-03-02T00:00:00.000Z' }),
    );
    const { qc, Wrapper } = makeWrapper();
    const invalidate = jest.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(
      () => useDismissWearablePrompt(WS),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync('prompt-1');
    });

    expect(api.dismiss).toHaveBeenCalledWith(WS, 'prompt-1');
    await waitFor(() =>
      expect(result.current.data?.dismissedAt).toBe('2026-03-02T00:00:00.000Z'),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: wearablePromptsKeys.all,
    });
  });
});

describe('useActOnWearablePrompt — mutation invalidates the list', () => {
  it('calls actOn with the prompt id and invalidates the list', async () => {
    api.actOn.mockResolvedValue(
      prompt({ id: 'prompt-1', actedOnAt: '2026-03-02T00:00:00.000Z' }),
    );
    const { qc, Wrapper } = makeWrapper();
    const invalidate = jest.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(
      () => useActOnWearablePrompt(WS),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync('prompt-1');
    });

    expect(api.actOn).toHaveBeenCalledWith(WS, 'prompt-1');
    await waitFor(() =>
      expect(result.current.data?.actedOnAt).toBe('2026-03-02T00:00:00.000Z'),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: wearablePromptsKeys.all,
    });
  });
});
