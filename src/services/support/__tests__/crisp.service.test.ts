/**
 * crisp.service.test.ts — Unit tests for the Crisp identity-sync service.
 *
 * Mocks `crisp-sdk-react-native` to verify that the service correctly
 * calls `setUserEmail`, `setUserNickname`, and `setSessionString` when
 * `syncCrispIdentity` is invoked with a valid user.
 */

// Must set env before importing the module under test so the module-level
// CRISP_WEBSITE_ID binding picks up the stubbed value.
process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID = 'test-website-id';

// Mock the Crisp SDK — native modules are not available in the test runner.
jest.mock('crisp-sdk-react-native', () => ({
  configure: jest.fn(),
  setUserEmail: jest.fn(),
  setUserNickname: jest.fn(),
  setSessionString: jest.fn(),
  show: jest.fn(),
}));

import * as CrispSDK from 'crisp-sdk-react-native';
import {
  initCrisp,
  syncCrispIdentity,
  resetCrispIdentity,
  type CrispUser,
} from '../crisp.service';

const mockConfigure = CrispSDK.configure as jest.Mock;
const mockSetUserEmail = CrispSDK.setUserEmail as jest.Mock;
const mockSetUserNickname = CrispSDK.setUserNickname as jest.Mock;
const mockSetSessionString = CrispSDK.setSessionString as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the module-level `configured` guard so each test starts fresh.
  // We do this by re-importing the module with jest.resetModules() or by
  // calling initCrisp() only once per describe block where needed.
  jest.resetModules();
});

describe('initCrisp', () => {
  it('calls configure with the website ID from env', () => {
    // Re-import after resetModules so the guard starts at false.
    process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID = 'test-website-id';
    jest.mock('crisp-sdk-react-native', () => ({
      configure: jest.fn(),
      setUserEmail: jest.fn(),
      setUserNickname: jest.fn(),
      setSessionString: jest.fn(),
      show: jest.fn(),
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initCrisp: init } = require('../crisp.service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('crisp-sdk-react-native');
    init();
    expect(sdk.configure).toHaveBeenCalledWith('test-website-id');
  });

  it('does not call configure twice when called multiple times', () => {
    jest.mock('crisp-sdk-react-native', () => ({
      configure: jest.fn(),
      setUserEmail: jest.fn(),
      setUserNickname: jest.fn(),
      setSessionString: jest.fn(),
      show: jest.fn(),
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initCrisp: init } = require('../crisp.service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('crisp-sdk-react-native');
    init();
    init();
    expect(sdk.configure).toHaveBeenCalledTimes(1);
  });
});

describe('syncCrispIdentity', () => {
  const baseUser: CrispUser = {
    email: 'alice@example.com',
    displayName: 'Alice',
    planTier: 'pro',
    role: 'student',
    tenantId: 'tenant-123',
  };

  it('calls setUserEmail with the user email', () => {
    process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID = 'test-website-id';
    jest.mock('crisp-sdk-react-native', () => ({
      configure: jest.fn(),
      setUserEmail: jest.fn(),
      setUserNickname: jest.fn(),
      setSessionString: jest.fn(),
      show: jest.fn(),
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { syncCrispIdentity: sync } = require('../crisp.service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('crisp-sdk-react-native');
    sync(baseUser);
    expect(sdk.setUserEmail).toHaveBeenCalledWith('alice@example.com');
  });

  it('calls setUserNickname with the display name', () => {
    process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID = 'test-website-id';
    jest.mock('crisp-sdk-react-native', () => ({
      configure: jest.fn(),
      setUserEmail: jest.fn(),
      setUserNickname: jest.fn(),
      setSessionString: jest.fn(),
      show: jest.fn(),
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { syncCrispIdentity: sync } = require('../crisp.service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('crisp-sdk-react-native');
    sync(baseUser);
    expect(sdk.setUserNickname).toHaveBeenCalledWith('Alice');
  });

  it('sets planTier, role, and tenantId as session strings', () => {
    process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID = 'test-website-id';
    jest.mock('crisp-sdk-react-native', () => ({
      configure: jest.fn(),
      setUserEmail: jest.fn(),
      setUserNickname: jest.fn(),
      setSessionString: jest.fn(),
      show: jest.fn(),
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { syncCrispIdentity: sync } = require('../crisp.service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('crisp-sdk-react-native');
    sync(baseUser);
    expect(sdk.setSessionString).toHaveBeenCalledWith('planTier', 'pro');
    expect(sdk.setSessionString).toHaveBeenCalledWith('role', 'student');
    expect(sdk.setSessionString).toHaveBeenCalledWith('tenantId', 'tenant-123');
  });

  it('falls back to email prefix when displayName is absent', () => {
    process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID = 'test-website-id';
    jest.mock('crisp-sdk-react-native', () => ({
      configure: jest.fn(),
      setUserEmail: jest.fn(),
      setUserNickname: jest.fn(),
      setSessionString: jest.fn(),
      show: jest.fn(),
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { syncCrispIdentity: sync } = require('../crisp.service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('crisp-sdk-react-native');
    sync({ email: 'bob@example.com' });
    expect(sdk.setUserNickname).toHaveBeenCalledWith('bob');
  });

  it('is a no-op when EXPO_PUBLIC_CRISP_WEBSITE_ID is empty', () => {
    process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID = '';
    jest.mock('crisp-sdk-react-native', () => ({
      configure: jest.fn(),
      setUserEmail: jest.fn(),
      setUserNickname: jest.fn(),
      setSessionString: jest.fn(),
      show: jest.fn(),
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { syncCrispIdentity: sync } = require('../crisp.service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('crisp-sdk-react-native');
    sync(baseUser);
    expect(sdk.setUserEmail).not.toHaveBeenCalled();
  });
});

describe('resetCrispIdentity', () => {
  it('is callable without throwing', () => {
    expect(() => resetCrispIdentity()).not.toThrow();
  });
});
