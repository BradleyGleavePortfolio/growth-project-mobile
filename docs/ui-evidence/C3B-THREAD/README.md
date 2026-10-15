# C3B-THREAD web renders (client coach thread, Style B, `c3StyleB` on)

These are React Native Web renders in headless Chromium of the real `MessagesScreen` code at this branch, with fixture data
only (network blocked; API, flags, storage, network status and haptics replaced by local stubs). They are NOT device proof:
check on a TestFlight / internal Android build before release. Text at 130% multiplies text size only (web has no Dynamic
Type); layout and tap targets keep their point size. The app's own `OfflineBanner` (unchanged, C1) is mounted above the
screen in the waiting and offline states, as on the device. Safe-area insets are 0 in these renders.

| State | What it shows |
|---|---|
| thread | Coach header ("Your coach"), serif day marks, forest client and cream coach bubbles, "6:03 pm" times, "Read 6:03 pm" |
| first | No messages yet: forest hero card "Say hello to Sam" over main's "Start a conversation with your coach" |
| failed | Online send failed: warm gold edge and "Not sent. Tap to send again" (44 pt button), no red |
| waiting | Offline: two messages with a dashed edge and "Waiting to send"; main's muted "Messages could not be loaded" line |
| offline | Offline with history from the device cache |
| loading | Skeleton bubbles ("Loading your messages" progressbar for screen readers) under a working back button |

Files: `C3B-<state>-<ios390|android360>-<100|130>.png` (24), `contact-sheet.png`, `measurements.jsonl` (one line per render:
tap targets and the smallest, contrast of every visible text against its real background, clipped text, page errors).

Results over all 24: every tap target is at least 44 x 44 pt; no text is clipped or runs off screen; no page errors; every
text in this screen is 4.5:1 or better (lowest 4.92:1, muted grey on bone). The one pair under 4.5:1 is the app's existing
`OfflineBanner` (cream on gold 700, 4.39:1, 12 pt), which this job does not change (Found, not fixed in the PR).

Harness (not in the repo): `/home/user/workspace/ops148/work/C3B-THREAD/harness/` (from op-143 `expo-web-harness`).
