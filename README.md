# The Growth Project

A production-grade React Native nutrition coaching app built with Expo, TypeScript, and SQLite.

## Features

- **Calorie & Macro Tracking** — Log meals with protein, carbs, fat breakdowns
- **Meal Plans** — Coach-assigned weekly meal plans with daily targets
- **Recipe Library** — Searchable recipe database with filters and detailed views
- **Progress Tracking** — Weight logging with trend charts (Victory Native)
- **Intermittent Fasting** — Timer with protocol selection and streak tracking
- **AI Guide** — Context-aware nutrition chatbot
- **Coach Dashboard** — Multi-client management, reports, and invite system
- **Weekly Reports** — Shareable PDF-style progress summaries
- **Widgets & Shortcuts** — Home screen widget prep and quick actions
- **Dark Mode First** — Full dark theme throughout

## Tech Stack

- React Native 0.83 + Expo ~55 (managed workflow)
- TypeScript (strict mode, zero errors)
- expo-sqlite (async API)
- Zustand v5 (state management)
- React Navigation v7 (native stack + bottom tabs)
- Victory Native (charts)
- react-native-reanimated v4 (animations)
- expo-haptics (micro-interactions)

## Getting Started

See [SETUP.md](./SETUP.md) for detailed installation instructions.

```bash
npm install
npx expo start
```

## Project Structure

```
src/
├── components/       # Reusable UI components
├── constants/        # Colors, config
├── db/               # SQLite database layer
├── navigation/       # React Navigation setup
├── screens/
│   ├── auth/         # Login, Register, Onboarding
│   ├── client/       # Client-facing screens (8 tabs)
│   └── coach/        # Coach dashboard screens
├── store/            # Zustand state stores
├── types/            # TypeScript type definitions
└── utils/            # Helpers and utilities
```

## Architecture

- **Multi-tenant RBAC**: Coach and client roles with scoped data access
- **Stack-in-tab navigation**: ProfileStack inside tab navigator for deep linking
- **Offline-first**: All data stored locally in SQLite
- **Component composition**: Skeleton loaders, empty states, fade animations
