// Structured logger for The Growth Project mobile app.
//
// In development (__DEV__ === true) all log levels are forwarded to the
// native console so they appear in Metro / Xcode / Android Studio log viewers.
// In production the console calls are suppressed; the catch blocks are written
// so a future Sentry breadcrumb integration only needs to be added here.
//
// Note: __DEV__ is a React Native global injected by Metro at build time.
// It is declared in @types/react-native and does not need to be imported.

// eslint-disable-next-line no-var
declare var __DEV__: boolean;

type LogLevel = 'log' | 'warn' | 'error';

function log(level: LogLevel, context: string, ...args: unknown[]) {
  if (__DEV__) {
    console[level](`[${context}]`, ...args);
  }
  // In production, could forward to Sentry breadcrumbs here
}

export const logger = {
  log: (context: string, ...args: unknown[]) => log('log', context, ...args),
  warn: (context: string, ...args: unknown[]) => log('warn', context, ...args),
  error: (context: string, ...args: unknown[]) => log('error', context, ...args),
};
