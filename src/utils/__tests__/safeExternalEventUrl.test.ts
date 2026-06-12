/**
 * safeExternalEventUrl — https-only scheme guard (F3).
 *
 * The single EXTERNAL event link is opened in the system browser; there is no
 * native room (Step 0). Before any `Linking.openURL`, the URL must be proven
 * `https:`. This pins the hostile-scheme rejections the audit called out
 * (`javascript:`, `data:`, plain `http:`) plus the calm null-on-garbage path.
 */
import { safeExternalEventUrl } from '../safeExternalEventUrl';

describe('safeExternalEventUrl', () => {
  it('returns the normalised href for a valid https URL', () => {
    expect(safeExternalEventUrl('https://example.com/live')).toBe(
      'https://example.com/live',
    );
  });

  it('rejects a javascript: scheme (no code execution)', () => {
    expect(safeExternalEventUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects a data: scheme', () => {
    expect(safeExternalEventUrl('data:text/html,<script>1</script>')).toBeNull();
  });

  it('rejects plain http: (no downgrade)', () => {
    expect(safeExternalEventUrl('http://example.com/live')).toBeNull();
  });

  it('rejects a file: scheme', () => {
    expect(safeExternalEventUrl('file:///etc/passwd')).toBeNull();
  });

  it('returns null for unparseable, empty, null, or undefined input', () => {
    expect(safeExternalEventUrl('not a url')).toBeNull();
    expect(safeExternalEventUrl('')).toBeNull();
    expect(safeExternalEventUrl(null)).toBeNull();
    expect(safeExternalEventUrl(undefined)).toBeNull();
  });
});
