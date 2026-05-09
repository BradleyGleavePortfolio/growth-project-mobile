// Audit fix CR-1: unit tests for the fragment->query rewrite that
// makes the Supabase password-recovery deep link reachable from the
// React Navigation linking config.
//
// The Supabase recovery email looks like:
//   tgp://reset-password#access_token=A&refresh_token=B&type=recovery
//
// Without `fragmentToQuery` the navigator sees `reset-password` with
// no params and the form has nothing to submit. With it, the tokens
// land in `route.params.access_token` / `refresh_token` so the
// ResetPasswordScreen can call supabase.auth.setSession + updateUser.

import { fragmentToQuery } from '../deepLinkUtils';

describe('fragmentToQuery', () => {
  it('hoists a fragment into a query string for the reset-password path', () => {
    const out = fragmentToQuery(
      'reset-password#access_token=A&refresh_token=B&type=recovery',
    );
    expect(out).toBe(
      'reset-password?access_token=A&refresh_token=B&type=recovery',
    );
  });

  it('handles a leading slash on the path', () => {
    const out = fragmentToQuery(
      '/reset-password#access_token=A&refresh_token=B',
    );
    expect(out).toBe('/reset-password?access_token=A&refresh_token=B');
  });

  it('appends to an existing query string with & rather than ?', () => {
    const out = fragmentToQuery(
      'reset-password?from=email#access_token=A&refresh_token=B',
    );
    expect(out).toBe(
      'reset-password?from=email&access_token=A&refresh_token=B',
    );
  });

  it('leaves a path without a fragment unchanged', () => {
    expect(fragmentToQuery('join/GP-ABC123')).toBe('join/GP-ABC123');
  });

  it('leaves an unrelated path with a fragment unchanged', () => {
    // Fragments on non-recovery paths are out of scope; we do not
    // want to inadvertently rewrite anchor links or other deep-link
    // formats that may grow over time.
    expect(fragmentToQuery('home#section=top')).toBe('home#section=top');
  });

  it('drops an empty fragment', () => {
    expect(fragmentToQuery('reset-password#')).toBe('reset-password');
  });
});
