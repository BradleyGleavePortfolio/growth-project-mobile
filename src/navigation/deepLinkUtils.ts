/**
 * Deep-link URL helpers for the navigator's linking config.
 *
 * Audit fix CR-1 (client POV): Supabase password-recovery emails put the
 * access_token + refresh_token pair in the URL fragment (everything
 * after `#`). React Navigation's linking parser only reads query
 * params (after `?`). Without the rewrite below, the user opens the
 * recovery email, the app launches via the `tgp://` deep link, and
 * the tokens are dropped on the floor — the form has nothing to
 * submit and the user is stuck.
 *
 * The rewrite is scoped to the reset-password path so unrelated deep
 * links (`tgp://join/<code>`, screenshot-mode routes) are unaffected.
 */

/**
 * Hoist a URL fragment into a query string so React Navigation's
 * linking config can parse the values into `route.params`.
 *
 * Examples:
 *   `reset-password#access_token=A&refresh_token=B`
 *     → `reset-password?access_token=A&refresh_token=B`
 *
 *   `reset-password?foo=1#access_token=A`
 *     → `reset-password?foo=1&access_token=A`
 *
 *   `join/GP-ABC123` (no fragment)
 *     → `join/GP-ABC123` (unchanged)
 *
 *   `home#section=top` (fragment, but not the recovery path)
 *     → `home#section=top` (unchanged — out of scope)
 */
export function fragmentToQuery(rawPath: string): string {
  const hashIdx = rawPath.indexOf('#');
  if (hashIdx === -1) return rawPath;

  const base = rawPath.slice(0, hashIdx);
  const fragment = rawPath.slice(hashIdx + 1);
  if (!fragment) return base;

  // Restrict the rewrite to the recovery path so this hook never
  // changes behaviour for unrelated links. The leading slash is
  // optional because React Navigation may pass either form.
  const isRecoveryPath =
    base.startsWith('/reset-password') || base.startsWith('reset-password');
  if (!isRecoveryPath) return rawPath;

  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${fragment}`;
}
