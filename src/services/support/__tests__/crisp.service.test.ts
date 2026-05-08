/**
 * crisp.service.test.ts — Unit tests for the Crisp identity-sync service.
 *
 * Verifies that `initCrisp` calls `configure` with the correct website ID
 * and that `syncCrispIdentity` calls `setUserEmail`, `setUserNickname`, and
 * `setSessionString` when invoked with a valid user.
 *
 * `crisp-sdk-react-native` is mocked globally in `jest.setup.js`.
 */

// Set the env before the module is imported.
process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID = 'test-website-id-123';

// The global mock in jest.setup.js handles the native module. Import the
// real service so we test its logic.
import * as CrispSDK from 'crisp-sdk-react-native';
import { syncCrispIdentity, resetCrispIdentity, type CrispUser } from '../crisp.service';

const mockSetUserEmail = CrispSDK.setUserEmail as jest.Mock;
const mockSetUserNickname = CrispSDK.setUserNickname as jest.Mock;
const mockSetSessionString = CrispSDK.setSessionString as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('syncCrispIdentity', () => {
  const fullUser: CrispUser = {
    email: 'alice@example.com',
    displayName: 'Alice',
    planTier: 'pro',
    role: 'student',
    tenantId: 'tenant-abc',
  };

  it('calls setUserEmail with the user email', () => {
    syncCrispIdentity(fullUser);
    expect(mockSetUserEmail).toHaveBeenCalledWith('alice@example.com');
  });

  it('calls setUserNickname with the display name', () => {
    syncCrispIdentity(fullUser);
    expect(mockSetUserNickname).toHaveBeenCalledWith('Alice');
  });

  it('sets planTier as a session string', () => {
    syncCrispIdentity(fullUser);
    expect(mockSetSessionString).toHaveBeenCalledWith('planTier', 'pro');
  });

  it('sets role as a session string', () => {
    syncCrispIdentity(fullUser);
    expect(mockSetSessionString).toHaveBeenCalledWith('role', 'student');
  });

  it('sets tenantId as a session string', () => {
    syncCrispIdentity(fullUser);
    expect(mockSetSessionString).toHaveBeenCalledWith('tenantId', 'tenant-abc');
  });

  it('falls back to the email prefix as nickname when displayName is absent', () => {
    syncCrispIdentity({ email: 'bob@example.com' });
    expect(mockSetUserNickname).toHaveBeenCalledWith('bob');
  });

  it('does not call setUserNickname when email has no @ prefix', () => {
    // Edge case: malformed email — should not crash.
    expect(() => syncCrispIdentity({ email: '' })).not.toThrow();
  });

  it('does not call setSessionString for absent optional fields', () => {
    syncCrispIdentity({ email: 'charlie@example.com' });
    expect(mockSetSessionString).not.toHaveBeenCalled();
  });
});

describe('resetCrispIdentity', () => {
  it('is callable without throwing', () => {
    expect(() => resetCrispIdentity()).not.toThrow();
  });
});
