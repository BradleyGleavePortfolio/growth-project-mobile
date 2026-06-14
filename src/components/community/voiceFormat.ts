/**
 * voiceFormat — pure formatting + downsampling helpers shared by the v3-3
 * voice-note components (waveform, player, record button). Kept separate from
 * the React components so they are unit-testable without rendering.
 *
 * No I/O, no platform calls — pure functions only.
 */

/** Format a millisecond duration as `m:ss` (e.g. 4200 → "0:04", 65000 → "1:05"). */
export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.round(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Downsample (or pad) a raw amplitude array to exactly `barCount` normalised
 * bars in [0,1], so the waveform renders a stable bar count regardless of the
 * recording length or metering granularity.
 *
 *   - Empty input → an array of `barCount` zeros (a calm flat baseline, never a
 *     crash or a NaN bar).
 *   - Each output bar is the average of its source bucket, clamped to [0,1].
 */
export function downsamplePeaks(peaks: number[], barCount: number): number[] {
  const bars = Math.max(0, Math.floor(barCount));
  if (bars === 0) return [];
  if (peaks.length === 0) return new Array(bars).fill(0);

  const out: number[] = new Array(bars).fill(0);
  const bucketSize = peaks.length / bars;
  for (let i = 0; i < bars; i += 1) {
    const startIdx = Math.floor(i * bucketSize);
    const endIdx = Math.min(peaks.length, Math.floor((i + 1) * bucketSize));
    let sum = 0;
    let count = 0;
    for (let j = startIdx; j < endIdx; j += 1) {
      const v = peaks[j];
      if (Number.isFinite(v)) {
        sum += v;
        count += 1;
      }
    }
    const avg = count > 0 ? sum / count : 0;
    out[i] = Math.min(1, Math.max(0, avg));
  }
  return out;
}

/** Format a byte count compactly for accessibility hints (e.g. "0.1 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
