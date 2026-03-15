// Type shim for @react-native-google-signin/google-signin
// The real package is a native module installed separately in a bare Expo workflow.
// This shim satisfies TypeScript's module resolution so tsc --noEmit passes.

declare module '@react-native-google-signin/google-signin' {
  export interface User {
    idToken: string | null;
    accessToken: string | null;
    user: {
      id: string;
      name: string | null;
      email: string;
      photo: string | null;
      familyName: string | null;
      givenName: string | null;
    };
  }

  export interface ConfigureParams {
    webClientId?: string;
    offlineAccess?: boolean;
    hostedDomain?: string;
    forceCodeForRefreshToken?: boolean;
    accountName?: string;
    iosClientId?: string;
    googleServicePlistPath?: string;
    openIdRealm?: string;
    profileImageSize?: number;
  }

  export const GoogleSignin: {
    configure(params?: ConfigureParams): void;
    hasPlayServices(params?: { showPlayServicesUpdateDialog?: boolean }): Promise<boolean>;
    signIn(): Promise<User>;
    signInSilently(): Promise<User>;
    signOut(): Promise<null>;
    revokeAccess(): Promise<null>;
    isSignedIn(): boolean;
    getCurrentUser(): User | null;
    getTokens(): Promise<{ idToken: string; accessToken: string }>;
  };

  export const statusCodes: {
    SIGN_IN_CANCELLED: string;
    IN_PROGRESS: string;
    PLAY_SERVICES_NOT_AVAILABLE: string;
    SIGN_IN_REQUIRED: string;
  };
}
