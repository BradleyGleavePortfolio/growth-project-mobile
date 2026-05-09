// Audit fix CR-4 / Coach #8: source-level guard for the
// invite-codes CTAs the brand-new coach needs to actually add a
// client.
//
// Three surfaces must reach the InviteCodes screen:
//   1. ClientsListScreen header pill (always visible)
//   2. ClientsListScreen empty state (zero clients)
//   3. CoachHomeScreen header pill (always visible)
//   4. MessagesScreen empty state (zero clients)
//
// Each test reads the source and asserts the wire by literal match.
// Mounting the full screens drags too many providers through the
// jest harness; the contract we care about is the navigate() call
// and the onInvite prop, both of which are simple to grep for.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');

const CLIENTS_LIST = read('src/screens/coach/ClientsListScreen.tsx');
const COACH_HOME = read('src/screens/coach/CoachHomeScreen.tsx');
const MESSAGES = read('src/screens/coach/MessagesScreen.tsx');

describe('ClientsListScreen invite CTAs', () => {
  it('header pill navigates to InviteCodes', () => {
    expect(CLIENTS_LIST).toMatch(
      /onPress=\{goToInviteCodes\}|navigation\.navigate\('InviteCodes'\)/,
    );
  });

  it('exposes a testID for the header invite pill', () => {
    expect(CLIENTS_LIST).toMatch(/testID="clients-invite-pill"/);
  });

  it('passes onInvite to the empty state so the CTA renders', () => {
    expect(CLIENTS_LIST).toMatch(/<EmptyStateNoClients\s+onInvite=\{goToInviteCodes\}/);
  });
});

describe('CoachHomeScreen invite CTA', () => {
  it('header pill routes through ClientsStack to InviteCodes', () => {
    expect(COACH_HOME).toMatch(
      /navigation\.navigate\('ClientsStack',\s*\{\s*screen:\s*'InviteCodes'/,
    );
  });

  it('exposes a testID for the home invite pill', () => {
    expect(COACH_HOME).toMatch(/testID="coach-home-invite-pill"/);
  });
});

describe('MessagesScreen empty-state invite CTA', () => {
  it('passes onInvite into EmptyStateNoClients via ClientsStack > InviteCodes', () => {
    expect(MESSAGES).toMatch(
      /<EmptyStateNoClients[\s\S]*?onInvite=\{[\s\S]*?navigation\.navigate\('ClientsStack',\s*\{\s*screen:\s*'InviteCodes'/,
    );
  });
});
