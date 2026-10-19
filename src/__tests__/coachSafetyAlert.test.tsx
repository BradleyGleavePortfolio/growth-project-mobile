/**
 * B-R1F (owner 22a, 57, 57w, 57x): the two Roman safety coach alerts.
 *
 *   - The card: line 1 is the server's sentence; line 2 is the client's own
 *     message on one muted line with a tail ellipsis; no name header.
 *   - Tapping the card opens the detail screen: name, time sent, the full
 *     message, the one fixed line, and "Message {first name}" to the chat.
 *   - A safety alert push or inbox row opens that alert by id (owner 57d):
 *     the shared skeleton, then the alert with one warning haptic. An alert
 *     the coach can't read lands on Command Center > Actions, as before.
 *     Rows sent before 57d (CoachActionQueue) still open Actions.
 *   - #ROMAN-CRISIS-ALERT: the crisis alert uses the same card and screen and
 *     never shows the client's words; an alert type the app does not know is
 *     handled as before.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: {
    selection: jest.fn(),
    softImpact: jest.fn(),
    mediumImpact: jest.fn(),
    heavyImpact: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../services/commandCenterApi', () => {
  const original = jest.requireActual('../services/commandCenterApi');
  return {
    ...original,
    __USING_MOCK_DATA: false,
    commandCenterApi: { getActionQueue: jest.fn(), dismissAlert: jest.fn(), getSafetyAlert: jest.fn() },
  };
});

import { commandCenterApi, type ActionQueueItem } from '../services/commandCenterApi';
import ActionQueueScreen from '../screens/coach/command-center/ActionQueueScreen';
import AlertRow from '../components/command-center/AlertRow';
import CoachSafetyAlertScreen, { formatSentAt } from '../screens/coach/CoachSafetyAlertScreen';
import {
  __resetPushTapRouterForTests,
  attachPushNavigator,
  routeInAppNotification,
  routePushTap,
  setPushSession,
  type PushNavigator,
} from '../services/pushTapRouter';
import { lightTokens } from '../theme/tokens';
import { HapticService } from '../ui/haptics/haptics.service';
import { chatTarget } from '../navigation/coachInbox';

// SAFETY-CHAT-ROUTE: Message {first name} opens that client's chat through openInboxChat (in Messages with the six
// tabs; off, over the alert). The routes and Back: coachChatRoute159.test.tsx.
const chatOf = (clientId: string, clientName: string) => {
  const { tab, params } = chatTarget(clientId, clientName);
  return [tab, params];
};

const URGENT_LINE = 'Urgent: Roman sent Jane Doe a medical safety reply. Check in with them →';
const ED_LINE = 'Roman sent Sam Lee an eating-disorder safety reply. Check in with them →';
const QUOTE = 'A persistent-vomiting message,\nwritten over two lines and long enough to be cut off on the card.';
const SENT = '2026-10-12T16:41:00.000Z';
const CRISIS_LINE = 'Roman sent Maya a crisis safety reply. Please check in with them today.';

const urgent: ActionQueueItem = {
  alert_id: 'a1',
  client_id: 'client-1',
  client_name: 'Jane Doe',
  alert_type: 'roman_urgent_reply',
  message: URGENT_LINE,
  created_at: SENT,
  dismissed_at: null,
  quote: QUOTE,
  sent_at: SENT,
};
const ed: ActionQueueItem = {
  ...urgent,
  alert_id: 'a2',
  client_id: 'client-2',
  client_name: 'Sam Lee',
  alert_type: 'roman_eating_disorder_reply',
  message: ED_LINE,
  quote: null,
  sent_at: null,
};
const crisis: ActionQueueItem = {
  ...urgent,
  alert_id: 'a3',
  client_id: 'client-3',
  client_name: 'Maya Collins',
  alert_type: 'roman_crisis_reply',
  message: CRISIS_LINE,
  quote: QUOTE, // never shown, even if a server ever sent one
  sent_at: null,
};

describe('the safety alert card', () => {
  it('line 1 in full, line 2 the message on one muted line with a tail ellipsis, no name header', async () => {
    const { getByText, getByTestId, queryByText, getByRole } = await render(
      <AlertRow clientName="Jane Doe" message={URGENT_LINE} quote={QUOTE} hideClientName onPress={() => {}} />,
    );
    expect(getByText(URGENT_LINE)).toBeTruthy();
    expect(queryByText('Jane Doe')).toBeNull();
    const quote = getByTestId('command-center-alert-quote');
    expect(quote.props.children).toBe(QUOTE.replace(/\s+/g, ' '));
    expect(quote.props.numberOfLines).toBe(1);
    expect(quote.props.ellipsizeMode).toBe('tail');
    expect(StyleSheet.flatten(quote.props.style).color).toBe(lightTokens.textMuted);
    expect(getByRole('button', { name: /^Urgent: Roman sent Jane Doe a medical safety reply\. Check in with them\. A persistent/ })).toBeTruthy();
  });

  it('both alerts use the same card; a deleted message leaves line 1 only', async () => {
    (commandCenterApi.getActionQueue as jest.Mock).mockResolvedValue({ data: { items: [urgent, ed], total_pending: 2 } });
    const onOpen = jest.fn();
    const { getAllByTestId, getByText } = await render(
      <ActionQueueScreen onOpenSafetyAlert={onOpen} onSelectClient={jest.fn()} />,
    );
    await waitFor(() => expect(getAllByTestId('command-center-safety-alert-row')).toHaveLength(2));
    expect(getByText(ED_LINE)).toBeTruthy();
    expect(getAllByTestId('command-center-alert-quote')).toHaveLength(1);
    await fireEvent.press(getByText(ED_LINE));
    expect(onOpen).toHaveBeenCalledWith(ed);
  });

  it('crisis: the same card with no quote; an unknown type is still an ordinary row', async () => {
    const unknown = { ...urgent, alert_id: 'a4', client_id: 'client-4', alert_type: 'some_new_type', quote: null };
    (commandCenterApi.getActionQueue as jest.Mock).mockResolvedValue({ data: { items: [crisis, unknown], total_pending: 2 } });
    const onOpen = jest.fn();
    const onSelectClient = jest.fn();
    const { getAllByTestId, getByRole, getByText, queryByTestId, queryByText } = await render(
      <ActionQueueScreen onOpenSafetyAlert={onOpen} onSelectClient={onSelectClient} />,
    );
    await waitFor(() => expect(getAllByTestId('command-center-safety-alert-row')).toHaveLength(1));
    expect(getByText(CRISIS_LINE).props.numberOfLines).toBe(0); // in full at any text size
    expect(queryByTestId('command-center-alert-quote')).toBeNull();
    expect(queryByText(QUOTE.replace(/\s+/g, ' '))).toBeNull();
    await fireEvent.press(getByRole('button', { name: CRISIS_LINE }));
    expect(onOpen).toHaveBeenCalledWith(crisis);
    expect(getAllByTestId('command-center-action-queue-row')).toHaveLength(1);
    await fireEvent.press(getByRole('button', { name: /^Jane Doe\./ }));
    expect(onSelectClient).toHaveBeenCalledWith('client-4', 'Jane Doe');
  });
});

describe('the detail screen', () => {
  beforeEach(() => jest.clearAllMocks());
  async function renderDetail(params: Record<string, unknown>) {
    const tabs = { navigate: jest.fn() };
    const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true, getParent: () => tabs };
    const utils = await render(
      <CoachSafetyAlertScreen
        route={{ key: 'k', name: 'CoachSafetyAlert', params } as never}
        navigation={navigation as never}
      />,
    );
    return { navigation, tabs, utils };
  }

  it('urgent: name, time sent, the full message, the fixed line, and Message {first name}', async () => {
    const { navigation, utils } = await renderDetail({
      alertType: 'roman_urgent_reply',
      clientId: 'client-1',
      clientName: 'Jane Doe',
      quote: QUOTE,
      sentAt: SENT,
    });
    const { getByText, getByTestId, getByRole } = utils;
    expect(getByText('Jane Doe')).toBeTruthy();
    expect(getByTestId('coach-safety-alert-sent').props.children).toBe(formatSentAt(SENT));
    expect(getByText(QUOTE)).toBeTruthy();
    expect(
      getByText('Roman told them to contact their doctor or prescriber today, and to call 911 if symptoms are severe.'),
    ).toBeTruthy();
    await fireEvent.press(getByRole('button', { name: 'Message Jane' }));
    expect(navigation.navigate).toHaveBeenCalledWith(...chatOf('client-1', 'Jane Doe'));
    await fireEvent.press(getByRole('button', { name: 'Back' }));
    expect(navigation.goBack).toHaveBeenCalled();
    expect(HapticService.warning).toHaveBeenCalledTimes(1);
    expect(commandCenterApi.getSafetyAlert).not.toHaveBeenCalled();
  });

  it('by id (push or inbox tap): the shared skeleton, then that alert, with one warning haptic', async () => {
    let answer: (v: { data: ActionQueueItem }) => void = () => {};
    (commandCenterApi.getSafetyAlert as jest.Mock).mockReturnValue(new Promise((r) => (answer = r)));
    const { navigation, tabs, utils } = await renderDetail({ alertId: 'a1' });
    const { getByLabelText, getByText, getByTestId, queryByTestId, getByRole } = utils;
    expect(commandCenterApi.getSafetyAlert).toHaveBeenCalledWith('a1');
    expect(getByLabelText('Loading')).toBeTruthy();
    expect(queryByTestId('coach-safety-alert-message')).toBeNull();
    expect(HapticService.warning).not.toHaveBeenCalled();
    answer({ data: urgent });
    await waitFor(() => expect(getByText(QUOTE)).toBeTruthy());
    expect(getByText('Jane Doe')).toBeTruthy();
    expect(getByTestId('coach-safety-alert-sent').props.children).toBe(formatSentAt(SENT));
    expect(queryByTestId('coach-safety-alert-loading')).toBeNull();
    expect(HapticService.warning).toHaveBeenCalledTimes(1);
    await fireEvent.press(getByRole('button', { name: 'Message Jane' }));
    expect(navigation.navigate).toHaveBeenCalledWith(...chatOf('client-1', 'Jane Doe'));
    expect(tabs.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['the server will not give it (another coach, a deleted message)', () => Promise.reject(new Error('404'))],
    ['it is not a safety alert', () => Promise.resolve({ data: { ...urgent, alert_type: 'missed_checkins' } })],
    ['it is a type this app does not know', () => Promise.resolve({ data: { ...urgent, alert_type: 'some_new_type' } })],
  ])('by id, when %s: Command Center > Actions, as before, with no new words', async (_label, reply) => {
    (commandCenterApi.getSafetyAlert as jest.Mock).mockImplementation(reply);
    const { navigation, tabs, utils } = await renderDetail({ alertId: 'a9' });
    await waitFor(() => expect(tabs.navigate).toHaveBeenCalledWith('CommandCenter', { tab: 'action-queue' }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(utils.queryByTestId('coach-safety-alert-excluded')).toBeNull();
    expect(HapticService.warning).not.toHaveBeenCalled();
  });

  it('eating disorder: its own fixed line; no quote block once the message is deleted', async () => {
    const { utils } = await renderDetail({
      alertType: 'roman_eating_disorder_reply',
      clientId: 'client-2',
      clientName: 'Sam Lee',
      quote: null,
      sentAt: SENT,
    });
    const { getByText, queryByTestId, getByRole } = utils;
    expect(getByText('Roman answered with eating-disorder safety guidance.')).toBeTruthy();
    expect(queryByTestId('coach-safety-alert-quote')).toBeNull();
    expect(getByRole('button', { name: 'Message Sam' })).toBeTruthy();
  });

  it('crisis: the approved line with the first name, never a quote, and Message {first name}', async () => {
    const { navigation, utils } = await renderDetail({
      alertType: 'roman_crisis_reply',
      clientId: 'client-3',
      clientName: 'Maya Collins',
      quote: QUOTE,
      sentAt: SENT,
    });
    const { getByText, getByTestId, queryByTestId, queryByText, getByRole } = utils;
    expect(getByText('Maya Collins')).toBeTruthy();
    expect(getByTestId('coach-safety-alert-summary').props.children).toBe(CRISIS_LINE);
    expect(queryByTestId('coach-safety-alert-quote')).toBeNull();
    expect(queryByText(QUOTE)).toBeNull();
    await fireEvent.press(getByRole('button', { name: 'Message Maya' }));
    expect(navigation.navigate).toHaveBeenCalledWith(...chatOf('client-3', 'Maya Collins'));
    expect(HapticService.warning).toHaveBeenCalledTimes(1);
  });

  it('crisis by id: opens with no quote and the alert time when the server sends no sent time', async () => {
    (commandCenterApi.getSafetyAlert as jest.Mock).mockResolvedValue({ data: { ...crisis, quote: null } });
    const { tabs, utils } = await renderDetail({ alertId: 'a3' });
    await waitFor(() => expect(utils.getByText(CRISIS_LINE)).toBeTruthy());
    expect(utils.getByTestId('coach-safety-alert-sent').props.children).toBe(formatSentAt(SENT));
    expect(utils.queryByTestId('coach-safety-alert-quote')).toBeNull();
    expect(tabs.navigate).not.toHaveBeenCalled();
  });
});

describe('the push and inbox route', () => {
  afterEach(() => __resetPushTapRouterForTests());

  function coachNav() {
    const nav = {
      navigate: jest.fn(),
      isReady: () => true,
      getRootState: () => ({ routeNames: ['CommandCenter', 'ClientsStack', 'SettingsStack'] }),
    };
    attachPushNavigator(nav as unknown as PushNavigator);
    setPushSession({ kind: 'app', userId: 'coach-1', role: 'coach' });
    return nav;
  }

  it('CoachSafetyAlert { alertId } (push tap or inbox row) opens that alert over the Clients list', () => {
    const nav = coachNav();
    expect(routeInAppNotification('CoachSafetyAlert', { alertId: 'a1' })).toBe(true);
    routePushTap('CoachSafetyAlert', { alertId: 'a1' }, 'push-1');
    const opened = ['ClientsStack', { screen: 'CoachSafetyAlert', params: { alertId: 'a1' }, initial: false }];
    expect(nav.navigate.mock.calls).toEqual([opened, opened]);
  });

  it('CoachActionQueue (rows sent before 57d) opens Command Center on the Actions tab', () => {
    const nav = coachNav();
    expect(routeInAppNotification('CoachActionQueue')).toBe(true);
    routePushTap('CoachActionQueue', undefined, 'push-1');
    expect(nav.navigate.mock.calls).toEqual([
      ['CommandCenter', { tab: 'action-queue' }],
      ['CommandCenter', { tab: 'action-queue' }],
    ]);
  });
});
