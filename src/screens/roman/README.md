# Roman chat

`RomanChatScreen.tsx` serves client and coach chat. Its header keeps Roman's avatar and conversation-history action, and includes a labelled, theme-coloured 44 pt Back control whenever mounted in a navigator. Back calls the current stack's `goBack`, including loading, offline, unavailable and error states.

Home's Roman shortcut navigates to `MoreTab / RomanChat` with `initial: false`, so a first visit keeps `MoreIndex` underneath chat. The You menu, settings, membership and sign-out remain reachable without restarting. The You-menu Roman row continues to use its existing stack navigation.

`useRomanChat.ts` reads the existing account-bound `GET /roman/sessions?limit=1` before opening today's session. Only an account with no earlier chats and an empty resumed session gets the first-meeting introduction; an earlier chat or failed history lookup selects returning-user copy. This is greeting metadata only: chat opening, sending, refusal handling, quotas, deletion events and paging are unchanged.

Regression evidence: `__tests__/RomanChatNav.test.tsx` covers Back in every load state, client/coach parity, history, composer editing, preserved draft, send retry and older messages. `__tests__/RomanGreetingHistory.test.tsx` covers no prior chats, returning clients and failed history reads. `../../components/home/__tests__/HomeHeaderActions.test.tsx` pins the nested-navigation payload and the unchanged message/bell actions.
