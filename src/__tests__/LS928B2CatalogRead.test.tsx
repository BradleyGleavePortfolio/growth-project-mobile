import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useExerciseNames } from '../hooks/useExerciseNames';
import { useBodyWeightExercises } from '../hooks/useBodyWeightExercises';

const mockGetById = jest.fn();
jest.mock('../api/exerciseLibraryApi', () => ({
  exerciseLibraryApi: { getById: (...args: unknown[]) => mockGetById(...args) },
}));

let client: QueryClient;
beforeEach(() => {
  mockGetById.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  });
});
afterEach(() => client.clear());

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('reads the same raw Exercise cache shape when both catalog consumers mount', async () => {
  const exercise = { id: 'plank', name: 'Plank', equipment: 'body weight' };
  const key = ['exercises', 'by-id', 'plank'];
  client.setQueryData(key, exercise);
  const result = await renderHook(() => ({
    bodyWeight: useBodyWeightExercises(['plank']),
    names: useExerciseNames(['plank']),
  }), { wrapper });
  await waitFor(() => expect(result.result.current.names.names.plank).toBe('Plank'));
  expect(result.result.current.bodyWeight.plank).toBe(true);
  expect(client.getQueryData(key)).toEqual(exercise);
  expect(mockGetById).not.toHaveBeenCalled();
});

it('a phone-made ex_ ID costs one failed catalog read for both consumers', async () => {
  mockGetById.mockRejectedValue({
    response: { status: 404, data: { message: 'Exercise not found' } },
  });
  const result = await renderHook(() => ({
    names: useExerciseNames(['ex_phone_legacy']),
    bodyWeight: useBodyWeightExercises(['ex_phone_legacy']),
  }), { wrapper });
  await waitFor(() =>
    expect(client.getQueryState(['exercises', 'by-id', 'ex_phone_legacy'])?.status).toBe('error'),
  );
  expect(result.result.current.names.names).toEqual({});
  expect(result.result.current.names.loading).toBe(false);
  expect(result.result.current.bodyWeight).toEqual({});
  expect(mockGetById).toHaveBeenCalledTimes(1);
});
