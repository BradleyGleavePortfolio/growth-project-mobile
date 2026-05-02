/**
 * Screenshot mode is controlled by EXPO_PUBLIC_SCREENSHOT_MODE. Any non-empty
 * value other than '0' or 'false' enables it. The check is intentionally
 * permissive so the flag can be set from a shell, an EAS env, or a `.env`
 * file without quoting confusion.
 */
export function isScreenshotMode(): boolean {
  const raw = process.env.EXPO_PUBLIC_SCREENSHOT_MODE;
  if (!raw) return false;
  const v = String(raw).toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
}
