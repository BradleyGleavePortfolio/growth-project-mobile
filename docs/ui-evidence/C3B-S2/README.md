# C3B-S2 web renders (client Messages list, Style B, `c3StyleB` and Roman chat on)

React Native Web renders in headless Chromium of the real `MessagesInboxScreen` at this branch, fixture data only
(network blocked; API, flags, current user, haptics and logger stubbed). NOT device proof: check on a device build before
release. 130% multiplies text size only (web has no Dynamic Type); layout and taps keep their size. Safe-area insets:
47/34 pt on the 390 renders, 24/0 pt on the 360 renders.

States: coached (Sam, 2 unread, last message, 36 left today); long (a 10-letter first name, 99+ unread, a long last
message, 97 left today); fallback (every read failed: "Message your coach", no count, no last message, no "left today",
both cards still open); loading (skeleton, progressbar "Loading your messages"); coachless (No coach connected, Join a
coach, Contact support, Roman works with a coach with the crisis line, Your conversations with Roman).

Files: `C3B-S2-<state>-<ios390|android360>-<100|130>.png` (20), `-full.png` where the column scrolls past the viewport
(3, coachless), `contact-sheet.png`, `measurements.jsonl` (per render: every role=button box, every visible text with its
colour, real background and contrast, clipped text, words split across lines, headers, progressbar and aria labels, page
errors; then the motion run and the tap routes). Measured where the column scrolls on the full-height page.

Over all 20: every tap target 44 x 44 pt or more, no clipped text, no split words, no page errors, every text 4.5:1 or
better (lowest 4.62:1, muted text on the cream card). Motion (coachless, 390): cards rise 16 pt and fade in about
200 ms, staggered; with prefers-reduced-motion nothing moves (0 pt while visible) and they fade in about 120-140 ms (the
150 ms timing, sampled per frame). Taps: Back -> goBack; coach card -> Messages; Roman card -> MoreTab RomanChat
(initial: false); privacy line and Your conversations with Roman -> MoreTab RomanConversations (initial: false). Join a
coach and Contact support call the app's own handlers (EntitlementProvider, useOpenSupport); the harness has no root
navigator, so those two are proven in `MessagesInboxScreen.test.tsx`.
