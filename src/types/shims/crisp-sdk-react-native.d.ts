// Type shim for crisp-sdk-react-native
// The SDK ships its own TypeScript types, but this shim satisfies tsc --noEmit
// during CI where node_modules may not include the native package.
// See docs/support-inbox.md for installation instructions.

declare module 'crisp-sdk-react-native' {
  /**
   * Configure the Crisp SDK with your Website ID.
   * Must be called once at app start.
   */
  export function configure(websiteId: string): void;

  /**
   * Open the Crisp chat overlay.
   */
  export function show(): void;

  /**
   * Hide the Crisp chat overlay.
   */
  export function hide(): void;

  /**
   * Set the authenticated user's email address.
   * @param email - User email.
   * @param signature - Optional HMAC signature for identity verification.
   */
  export function setUserEmail(email: string, signature?: string): void;

  /**
   * Set the authenticated user's display name.
   */
  export function setUserNickname(name: string): void;

  /**
   * Set the authenticated user's phone number.
   */
  export function setUserPhone(phone: string): void;

  /**
   * Set the authenticated user's avatar URL.
   */
  export function setUserAvatar(avatarUrl: string): void;

  /**
   * Store a custom string value in the Crisp session data.
   */
  export function setSessionString(key: string, value: string): void;

  /**
   * Store a custom boolean value in the Crisp session data.
   */
  export function setSessionBool(key: string, value: boolean): void;

  /**
   * Store a custom integer value in the Crisp session data.
   */
  export function setSessionInt(key: string, value: number): void;

  /**
   * Set a single segment to categorise this user.
   */
  export function setSessionSegment(segment: string): void;

  /**
   * Set multiple segments. Optionally overwrite existing segments.
   */
  export function setSessionSegments(segments: string[], overwrite?: boolean): void;

  /**
   * Get the current Crisp session identifier.
   */
  export function getSessionIdentifier(): Promise<string | null>;

  /**
   * Reset the current Crisp session.
   */
  export function resetSession(): void;
}
