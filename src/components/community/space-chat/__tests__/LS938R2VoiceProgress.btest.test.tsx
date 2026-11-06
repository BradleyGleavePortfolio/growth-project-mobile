import { renderHook } from '@testing-library/react-native';

const mockOutbox = { items: [] as unknown[], send: jest.fn(), retry: jest.fn(), discard: jest.fn() };
jest.mock('../../../../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => mockOutbox }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('../useSpaceChat', () => ({
  spaceChatKey: (user: string, cohort: string) => ['community', 'space-chat', user, cohort],
}));
import { useSpaceVoiceOutbox } from '../useSpaceVoiceOutbox';

it.each([0.4, 0.8])(
  'LS938R2 B5: a sending voice row follows upload progress %s without changing its time',
  async (progress) => {
    const first = {
      id: 'local-1793923200000-1',
      authorId: 'member-a',
      status: 'sending',
      progress: 0.1,
      input: { cohortId: 'space-a' },
    };
    mockOutbox.items = [first];
    const hook = await renderHook(() => useSpaceVoiceOutbox('workspace-a', 'member-a', 'space-a'));
    expect(hook.result.current.rows[0].v.progress).toBe(0.1);
    const originalTime = hook.result.current.rows[0].at;
    mockOutbox.items = [{ ...first, progress }];
    await hook.rerender({});
    expect(hook.result.current.rows[0].v.progress).toBe(progress);
    expect(hook.result.current.rows[0].at).toBe(originalTime);
    await hook.unmount();
  },
);
