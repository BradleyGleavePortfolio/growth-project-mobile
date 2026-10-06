/**
 * B-WEARLIST-125: the server-listed cloud trackers. An older server (404), a
 * network failure or a drifted body all mean "none listed", so Connections
 * behaves exactly as before; known cloud ids pass, others are dropped.
 */
const mockGet = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

import { fetchConnectableCloudProviders } from './useConnectableCloudProviders';

describe('fetchConnectableCloudProviders (B-WEARLIST-125)', () => {
  beforeEach(() => mockGet.mockReset());

  it('reads GET /v1/wearables/connections/providers and keeps known cloud ids', async () => {
    mockGet.mockResolvedValue({
      data: { providers: ['OURA', 'POLAR', 'APPLE_HEALTHKIT', 'NEW_THING'] },
    });
    await expect(fetchConnectableCloudProviders()).resolves.toEqual(['OURA', 'POLAR']);
    expect(mockGet).toHaveBeenCalledWith('/v1/wearables/connections/providers');
  });

  it('lists none when the server has no such route (404)', async () => {
    mockGet.mockRejectedValue(Object.assign(new Error('Request failed with status code 404'), {
      isAxiosError: true,
      response: { status: 404 },
    }));
    await expect(fetchConnectableCloudProviders()).resolves.toEqual([]);
  });

  it('lists none on a network failure or a drifted body', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network Error'));
    await expect(fetchConnectableCloudProviders()).resolves.toEqual([]);
    mockGet.mockResolvedValueOnce({ data: { providers: 'OURA' } });
    await expect(fetchConnectableCloudProviders()).resolves.toEqual([]);
  });
});
