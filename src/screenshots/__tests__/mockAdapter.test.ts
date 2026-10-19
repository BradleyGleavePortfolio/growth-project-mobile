import { AxiosHeaders, type AxiosAdapter } from 'axios';
import api from '../../services/api';
import { DEMO_USER, DEMO_RECIPES } from '../fixtures';
import { installAxiosMockAdapter } from '../mockAdapter';

jest.mock('../../services/api', () => ({ __esModule: true, default: { defaults: {} } }));

describe('screenshot fixture path matching', () => {
  const original = process.env.EXPO_PUBLIC_SCREENSHOT_MODE;
  afterAll(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_SCREENSHOT_MODE;
    else process.env.EXPO_PUBLIC_SCREENSHOT_MODE = original;
  });

  it.each([
    ['/coach/clients?status=active&take=50', [DEMO_USER]],
    ['https://capture.invalid/coach/clients?status=active&take=50', [DEMO_USER]],
    ['profile?include=coach', expect.objectContaining({ coach_id: DEMO_USER.coach_id })],
    [`/recipes/${DEMO_RECIPES[0].id}?source=store`, DEMO_RECIPES[0]],
  ])('returns the fixture for %s without changing the request', async (url, expected) => {
    process.env.EXPO_PUBLIC_SCREENSHOT_MODE = '1';
    installAxiosMockAdapter();
    const config = { method: 'get', url, headers: new AxiosHeaders() };
    const response = await (api.defaults.adapter as AxiosAdapter)(config);
    expect(response.status).toBe(200);
    expect(response.data).toEqual(expected);
    expect(response.config).toBe(config);
  });
});
