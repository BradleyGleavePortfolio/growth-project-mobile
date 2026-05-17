// Shared helpers used to keep `: any` out of the codebase. These let
// route handlers and API normalizers narrow `unknown` payloads without
// reaching for `any`.

import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

// JSON-shaped record returned by the backend. Use this as the input type
// for normalizers that defensively read fields out of an unknown shape.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRecord = { [key: string]: JsonValue };

// Type-name for the `name` prop on Ionicons. Pulling it from the
// component's own ComponentProps avoids drift with @expo/vector-icons.
export type IoniconName = ComponentProps<typeof Ionicons>['name'];

// Narrowed shape of an Axios-style error message bag — covers the fields
// the catch blocks across screens look at without pulling all of axios in.
export interface ApiErrorLike {
  message?: string;
  response?: {
    data?: { message?: string; error?: string } | string;
    status?: number;
  };
}

// Extract a human-readable message from an unknown error without using `any`.
// Axios response body wins over Error.message — the backend message is more
// specific than the generic JS error message.
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err && typeof err === 'object') {
    const e = err as { response?: { data?: unknown }; message?: string };
    const data = e.response?.data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (typeof d.message === 'string') return d.message;
      if (typeof d.error === 'string') return d.error;
    }
    if (typeof data === 'string') return data;
    if (typeof e.message === 'string') return e.message;
  }
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
}

// Pull a backend error code (e.g. "NO_COACH_ASSIGNED") off an axios-style
// error response. Returns undefined when missing.
export function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const e = err as ApiErrorLike;
    const data = e.response?.data;
    if (data && typeof data === 'object' && typeof data.error === 'string') {
      return data.error;
    }
  }
  return undefined;
}

// Pull the HTTP status off an axios-style error without using `any`.
// Returns undefined when the error doesn't look like an axios error.
export function errorStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const e = err as ApiErrorLike;
    return e.response?.status;
  }
  return undefined;
}

// Read a field out of an unknown payload without crashing. Returns
// undefined when the value isn't an object.
export function asRecord(value: unknown): JsonRecord | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return undefined;
}

export function asArray(value: unknown): JsonValue[] {
  return Array.isArray(value) ? (value as JsonValue[]) : [];
}
