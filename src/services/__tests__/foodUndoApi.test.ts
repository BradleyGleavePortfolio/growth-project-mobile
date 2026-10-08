import api, { fastingApi, waterApi } from '../api';

describe('food undo API routes', () => {
  afterEach(() => jest.restoreAllMocks());

  it('removes one saved water entry by id through the authenticated API instance', async () => {
    const deletion = jest.spyOn(api, 'delete').mockResolvedValue({ data: { id: 'water-1', deleted: true } });
    await waterApi.deleteEntry('water-1');
    expect(deletion).toHaveBeenCalledWith('/nutrition/water/water-1');
  });

  it('removes one saved fast by id through the authenticated API instance', async () => {
    const deletion = jest.spyOn(api, 'delete').mockResolvedValue({ data: { id: 'fast-1', deleted: true } });
    await fastingApi.deleteFast('fast-1');
    expect(deletion).toHaveBeenCalledWith('/fasting/fast-1');
  });
});
