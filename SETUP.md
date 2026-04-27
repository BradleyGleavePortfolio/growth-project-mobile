# Setup Guide

## Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (macOS) or Android Emulator

## Installation

```bash
git clone <repo-url>
cd growth-project-app
npm install
npx expo start
```

## Running on Device

```bash
npx expo run:ios
npx expo run:android
npx expo start          # physical device via QR
```

## Building for Production

```bash
npm install -g eas-cli
eas build:configure     # first time only
eas build --platform ios --profile production
eas build --platform android --profile production
```

## Environment Variables

The app reads required values from `EXPO_PUBLIC_*` env vars at build time.
Copy `.env.example` to `.env` for local dev, and configure the same keys in
`eas.json` build env for staging and production.

### Required (all builds)

| Var | Purpose |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (publishable) key |
| `EXPO_PUBLIC_API_URL` | Backend API base URL. Required in non-dev builds |

### Optional, observability and analytics

| Var | Purpose |
|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry DSN. When unset, `services/sentry.ts` no-ops and crashes go uncaptured. |
| `EXPO_PUBLIC_ENVIRONMENT` | Sentry environment tag. Defaults to `'production'`. |
| `EXPO_PUBLIC_POSTHOG_KEY` | PostHog project key. Empty string disables capture; the SDK no-ops cleanly. |
| `EXPO_PUBLIC_POSTHOG_HOST` | PostHog ingest URL. Defaults to `https://us.i.posthog.com`. |

### Google sign-in

Google sign-in is brokered entirely through Supabase OAuth. The mobile app
embeds no per-platform Google client ID and reads no `EXPO_PUBLIC_GOOGLE_*`
variable. The OAuth client / secret pair lives in the Supabase dashboard
(Authentication > Providers > Google), backed by a single Web client in
Google Cloud Console. The "Continue with Google" button on the signup
screen is hidden when the backend `signup-policy` endpoint returns
`google_signin_enabled: false`. Adding a `EXPO_PUBLIC_GOOGLE_CLIENT_ID_*`
key is rejected by `scripts/validate-app-config.js`.

### Google OAuth, backend wiring

For the invite-gated signup flow to attach a new Google user to the right
coach, the backend must accept `invite_code` on `POST /auth/google` (or
expose `POST /auth/attach-invite-code` as a follow-up). The mobile client
prefers the single-call form and falls back to the attach endpoint if the
single-call form does not yet support `invite_code`.

### Invite-gated signup

The mobile signup screen calls `GET /auth/signup-policy` on mount. The
backend should return `{ require_invite_code: boolean, google_signin_enabled: boolean }`.
When `require_invite_code` is true, codeless email + Google signups are
rejected client-side before the network call. The endpoint is optional;
if it 404s, the mobile app defaults to the strictest setting (require code).

### Deep links

Universal links / custom scheme are configured in `app.json`:

- `tgp://join/<code>` (custom scheme)
- `https://app.trygrowthproject.com/join/<code>` (universal link)

The mobile signup screen reads `route.params.invite_code` and prefills and
auto-validates it on mount.

## Troubleshooting

- **Metro bundler issues**: `npx expo start --clear`
- **TypeScript errors**: `npx tsc --noEmit`
- **Google sign-in returns "No access token received"**: the Supabase
  redirect failed. Inspect the URL fragment in the device console; likely
  causes are an unconfigured redirect URL in the Supabase dashboard or a
  blocked browser session.
- **"Cannot reach server" during signup**: `EXPO_PUBLIC_API_URL` is unset
  in your build, or the backend is cold starting. Wait roughly 25 sec or
  set the URL explicitly.
