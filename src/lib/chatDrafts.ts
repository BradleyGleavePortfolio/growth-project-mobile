import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { cacheStorage } from '../storage/mmkv';
import { authEvents } from '../utils/authEvents';

/**
 * CHAT-DISCARD (owner 10-21, op 1: "lets say a client types "Hey, loved th" and taps into another in-app notif/chat, he
 * should come abck to his message still half typed, saved as cache on his machin!"). Half-typed text in a chat is kept on
 * the device, per signed-in user and per chat, and is back in the box when that chat opens again. Coach and client chats
 * alike; nothing asks before leaving.
 *
 * Kept in the cache store (cacheStorage, so `clearAllStorage()` wipes it at sign-out) with an in-memory copy for an
 * instant refill; a sign-out or sign-in also empties the copy and removes every kept chat text from the device.
 *
 * A send that failed in a way that may have reached the server keeps its device key with its text (Sol B1, m#841), so
 * sending the same text again, even after the chat was closed and opened again, replays that key and can never post twice.
 */
export const CHAT_DRAFT_KEY_PREFIX = 'chat_draft_';

/** A failed send whose key must be replayed while the box still holds the same text. */
export interface FailedSend { text: string; key: string }
export interface ChatDraft { text: string; failed?: FailedSend }

const memory = new Map<string, ChatDraft>();
let sweep: Promise<void> = Promise.resolve();

const storageKey = (scope: string) => `${CHAT_DRAFT_KEY_PREFIX}${scope}`;

function parse(raw: string | undefined): ChatDraft | undefined {
  if (!raw) return undefined;
  try {
    const d = JSON.parse(raw) as Partial<ChatDraft>;
    if (typeof d?.text !== 'string' || d.text.trim() === '') return undefined;
    const f = d.failed;
    const failed = f && typeof f.text === 'string' && typeof f.key === 'string' ? { text: f.text, key: f.key } : undefined;
    return failed ? { text: d.text, failed } : { text: d.text };
  } catch {
    return undefined;
  }
}

/** Device writes never throw into typing or sending; a failed write leaves the in-memory copy. */
function quietly(task: () => unknown): void {
  void Promise.resolve().then(task).catch(() => undefined);
}

function forget(): void {
  memory.clear();
  sweep = sweep
    .then(() => cacheStorage.getAllKeys())
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CHAT_DRAFT_KEY_PREFIX)).map((k) => cacheStorage.delete(k))))
    .then(() => undefined, () => undefined);
}
try {
  authEvents.on('logout', forget);
  authEvents.on('login', forget);
} catch {
  // A test double without named events; a real sign-out still wipes the cache store (clearAllStorage).
}

/** The kept text for `<userId>:<thread>`, from memory or a synchronous device read (native MMKV). */
function readNow(scope: string): ChatDraft | undefined {
  if (memory.has(scope)) return memory.get(scope);
  let d: ChatDraft | undefined;
  try {
    d = parse(cacheStorage.getString(storageKey(scope)));
  } catch {
    d = undefined;
  }
  if (d) memory.set(scope, d);
  return d;
}

/** The same, read asynchronously (the AsyncStorage fallback has no synchronous read); never before a sign-out sweep ends. */
async function readLater(scope: string): Promise<ChatDraft | undefined> {
  await sweep;
  if (memory.has(scope)) return memory.get(scope);
  try {
    return parse(await cacheStorage.getStringAsync(storageKey(scope)));
  } catch {
    return undefined;
  }
}

function write(scope: string, draft: ChatDraft): void {
  const k = storageKey(scope);
  if (draft.text.trim() === '') {
    memory.delete(scope);
    quietly(() => cacheStorage.delete(k));
    return;
  }
  memory.set(scope, draft);
  quietly(() => cacheStorage.set(k, JSON.stringify(draft)));
}

/**
 * A passed draft (Send check-in) never drops kept text (Opus C1, m#841): the kept text stays first, then a blank line,
 * then the passed draft; a kept text that already holds the draft stays as it is.
 */
function withKept(kept: ChatDraft | undefined, passed: string): ChatDraft {
  if (!kept) return { text: passed };
  if (kept.text.includes(passed.trim())) return kept;
  return kept.failed ? { text: `${kept.text}\n\n${passed}`, failed: kept.failed } : { text: `${kept.text}\n\n${passed}` };
}

export type SetChatText = (next: string | ((current: string) => string)) => void;
export interface ChatSendKey {
  /** The failed send's key when `text` is the text it tried to send; otherwise undefined (a new send). */
  keyFor: (text: string) => string | undefined;
  /** Keep a failed send's key with its text, here and on the device. */
  keepFailed: (text: string, key: string) => void;
}

/**
 * A chat's text box, kept per signed-in user and per chat (`thread`, e.g. `coach:<clientId>`); `thread` null keeps it in
 * the component only. `initialText` (a passed draft, e.g. Send check-in) is added under kept text, never over it.
 * Emptying the box (every successful send) removes the kept text and any failed send's key with it.
 */
export function useChatDraft(thread: string | null, initialText?: string): [string, SetChatText, ChatSendKey] {
  const userId = useCurrentUser()?.id ?? null;
  const scope = thread && userId ? `${userId}:${thread}` : null;
  const [box, setBox] = useState<{ scope: string | null; draft: ChatDraft }>(() => ({ scope: null, draft: { text: initialText ?? '' } }));
  const passed = useRef(initialText !== undefined);
  // A passed draft waiting for the device read (no synchronous read), so it joins the kept text instead of replacing it.
  const merge = useRef(false);
  const live = useRef(box);

  let shown = box;
  if (box.scope !== scope) {
    // The user is known (the first render never has it) or the chat changed in place: show this chat's kept text. Text
    // typed before the user was known is kept for this chat instead; a passed draft goes under the kept text.
    const first = box.scope === null;
    const kept = scope ? readNow(scope) : undefined;
    const withDraft = first && passed.current;
    const carry = first && (withDraft || box.draft.text !== '');
    const draft = withDraft ? withKept(kept, box.draft.text) : carry ? box.draft : kept ?? { text: '' };
    shown = { scope, draft };
    if (carry && scope) {
      if (withDraft && !kept) merge.current = true;
      else write(scope, draft);
    }
    passed.current = false;
    setBox(shown);
  }
  live.current = shown;

  useEffect(() => {
    if (!scope || (live.current.draft.text !== '' && !merge.current)) return;
    let alive = true;
    void readLater(scope).then((d) => {
      if (!alive || live.current.scope !== scope) return;
      if (merge.current) {
        merge.current = false;
        live.current = { scope, draft: withKept(d, live.current.draft.text) };
        write(scope, live.current.draft);
      } else {
        if (!d || live.current.draft.text !== '') return;
        memory.set(scope, d);
        live.current = { scope, draft: d };
      }
      setBox(live.current);
    });
    return () => { alive = false; };
  }, [scope]);

  // The device copy is the truth for a known chat, so a send that settles after the chat closed (or changed in place)
  // updates that chat's own kept text and never shows in another chat. A setter kept from a render before the user was
  // known acts on the chat as it is now.
  const latest = useRef(scope);
  latest.current = scope;
  const current = useCallback((): ChatDraft => {
    const at = scope ?? latest.current;
    if (!at) return live.current.scope === null ? live.current.draft : { text: '' };
    return memory.get(at) ?? (live.current.scope === at ? live.current.draft : { text: '' });
  }, [scope]);
  const put = useCallback((draft: ChatDraft) => {
    const at = scope ?? latest.current;
    if (at) write(at, draft);
    if (live.current.scope === at) {
      live.current = { scope: at, draft };
      setBox(live.current);
    }
  }, [scope]);

  const setText = useCallback<SetChatText>((next) => {
    const prev = current();
    const text = typeof next === 'function' ? next(prev.text) : next;
    put(text.trim() !== '' && prev.failed ? { text, failed: prev.failed } : { text });
  }, [current, put]);

  const keyFor = useCallback((text: string) => {
    const failed = current().failed;
    return failed?.text === text ? failed.key : undefined;
  }, [current]);

  const keepFailed = useCallback((text: string, key: string) => {
    put({ text: current().text, failed: { text, key } });
  }, [current, put]);

  return [shown.draft.text, setText, { keyFor, keepFailed }];
}
