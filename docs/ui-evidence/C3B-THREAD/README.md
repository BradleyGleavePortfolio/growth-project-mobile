# C3B-THREAD web renders (client coach thread, Style B, `c3StyleB` on)

React Native Web renders in headless Chromium of the real `MessagesScreen` at this branch, fixture data only (network
blocked; API, flags, storage, network status and haptics stubbed). NOT device proof: check on a device build before release.
130% multiplies text size only (web has no Dynamic Type); layout and taps keep their size. Safe-area insets are 0. The app's
own `OfflineBanner` (unchanged) is mounted above the screen in the waiting and offline states, as on the device.

States: thread (header, serif day marks, forest and cream bubbles, "Read 6:03 pm"); first ("Say hello to Sam"); failed
(warm gold edge, 44 pt "Not sent. Tap to send again", no red); waiting (offline, dashed edges, "Waiting to send",
"2 messages send when you reconnect."); offline (history from the device cache); loading (skeleton bubbles, progressbar).

Files: `C3B-<state>-<ios390|android360>-<100|130>.png` (24), `contact-sheet.png`, `measurements.jsonl` (per render: tap
targets, contrast of every visible text on its real background, clipped text, page errors). Over all 24: every tap target
is 44 x 44 pt or more, no clipped text, no page errors, every text of this screen 4.5:1 or better (lowest 4.92:1). The one
pair under 4.5:1 is the unchanged `OfflineBanner` (cream on gold 700, 4.39:1), listed in the PR under Found, not fixed.
