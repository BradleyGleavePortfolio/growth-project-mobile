/**
 * Controllable fake of expo-audio (Expo SDK 56) for jest (B-314-2).
 *
 * jest.setup.js maps `expo-audio` to this module (virtual, so it works before
 * the shared node_modules carries the package). It mirrors the surface
 * src/services/voiceAudio.ts uses: createAudioPlayer, useAudioRecorder,
 * recording permissions, setAudioModeAsync and RecordingPresets. Plain
 * functions (not jest.fn) so a test's jest.resetAllMocks() cannot wipe the
 * implementation; tests read and drive it through `__mock`.
 *
 * A test can simulate a binary built before expo-audio was added (the real
 * entry module throws from requireNativeModule('ExpoAudio')) by setting
 * globalThis.__expoAudioNativeMissing = true and requiring inside
 * jest.isolateModules.
 */
if (globalThis.__expoAudioNativeMissing === true) {
  throw new Error("Cannot find native module 'ExpoAudio'");
}
const state = {
  players: [],
  recorders: [],
  audioModes: [],
  permission: { granted: true, status: 'granted', canAskAgain: true, expires: 'never' },
  requestedPermission: null,
  permissionRequests: 0,
  nextRecordingUri: 'file:///cache/recording-1.m4a',
};

class FakePlayer {
  constructor(source, options) {
    this.source = source;
    this.options = options;
    this.listeners = new Map();
    this.playing = false;
    this.removed = false;
    this.currentTime = 0;
    this.calls = [];
  }
  play() {
    this.calls.push('play');
    this.playing = true;
  }
  pause() {
    this.calls.push('pause');
    this.playing = false;
  }
  async seekTo(seconds) {
    this.calls.push(`seekTo:${seconds}`);
    this.currentTime = seconds;
  }
  remove() {
    this.calls.push('remove');
    this.removed = true;
  }
  addListener(event, fn) {
    const set = this.listeners.get(event) || new Set();
    set.add(fn);
    this.listeners.set(event, set);
    return { remove: () => set.delete(fn) };
  }
  /** Test helper: deliver a status update to the listeners. */
  emit(event, payload) {
    (this.listeners.get(event) || new Set()).forEach((fn) => fn(payload));
  }
}

class FakeRecorder {
  constructor(options) {
    this.options = options;
    this.uri = null;
    this.isRecording = false;
    this.durationMillis = 0;
    this.metering = -30;
    this.calls = [];
    this.failPrepare = null;
    this.failStop = null;
  }
  async prepareToRecordAsync() {
    this.calls.push('prepare');
    if (this.failPrepare) throw this.failPrepare;
  }
  record() {
    this.calls.push('record');
    this.isRecording = true;
  }
  async stop() {
    this.calls.push('stop');
    if (this.failStop) throw this.failStop;
    this.isRecording = false;
    this.uri = state.nextRecordingUri;
  }
  getStatus() {
    return {
      id: 'rec-1',
      canRecord: true,
      isRecording: this.isRecording,
      durationMillis: this.durationMillis,
      mediaServicesDidReset: false,
      metering: this.metering,
      url: this.uri,
    };
  }
}

function useAudioRecorder(options) {
  const React = require('react');
  const ref = React.useRef(null);
  if (ref.current === null) {
    ref.current = new FakeRecorder(options);
    state.recorders.push(ref.current);
  }
  return ref.current;
}

const preset = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 2,
  bitRate: 128000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: 'aac ', audioQuality: 127 },
  web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
};

module.exports = {
  createAudioPlayer(source, options) {
    const p = new FakePlayer(source, options);
    state.players.push(p);
    return p;
  },
  useAudioRecorder,
  async getRecordingPermissionsAsync() {
    return state.permission;
  },
  async requestRecordingPermissionsAsync() {
    state.permissionRequests += 1;
    if (state.requestedPermission) state.permission = state.requestedPermission;
    return state.permission;
  },
  async setAudioModeAsync(mode) {
    state.audioModes.push(mode);
  },
  RecordingPresets: { HIGH_QUALITY: preset, LOW_QUALITY: preset },
  __mock: {
    state,
    FakePlayer,
    FakeRecorder,
    reset() {
      state.players = [];
      state.recorders = [];
      state.audioModes = [];
      state.permission = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' };
      state.requestedPermission = null;
      state.permissionRequests = 0;
      state.nextRecordingUri = 'file:///cache/recording-1.m4a';
    },
  },
};
