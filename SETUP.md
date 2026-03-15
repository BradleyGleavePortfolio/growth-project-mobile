# Setup Guide

## Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (macOS) or Android Emulator

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd growth-project-app

# Install dependencies
npm install

# Start the development server
npx expo start
```

## Running on Device

```bash
# iOS Simulator
npx expo run:ios

# Android Emulator
npx expo run:android

# Physical device (scan QR code)
npx expo start
```

## Building for Production

```bash
# Install EAS CLI
npm install -g eas-cli

# Configure EAS (first time only)
eas build:configure

# Build for iOS
eas build --platform ios --profile production

# Build for Android
eas build --platform android --profile production
```

## Environment

- No `.env` file required — all data is stored locally
- SQLite database is initialized on first launch
- Demo coach account is seeded automatically

## Troubleshooting

- **Metro bundler issues**: `npx expo start --clear`
- **TypeScript errors**: `npx tsc --noEmit` to check
- **SQLite issues**: Delete app data and restart
- **Expo Go limitations**: Some native modules require a development build
