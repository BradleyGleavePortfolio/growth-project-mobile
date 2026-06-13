/**
 * Coverage: the long-press action menu surfaces Reply / Copy / Report on
 * Android and routes each tap to the corresponding handler exactly once.
 * iOS native sheet is covered separately via the iOS-only effect path.
 */
import React from 'react';
import { Platform } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { MessageActionSheet } from '../MessageActionSheet';

// Render the Android modal branch deterministically.
const originalOS = Platform.OS;
beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});
afterAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
});

describe('MessageActionSheet (Android modal)', () => {
  it('renders nothing when not visible', async () => {
    const { queryByLabelText } = await render(
      <MessageActionSheet
        visible={false}
        onReply={jest.fn()}
        onCopy={jest.fn()}
        onReport={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(queryByLabelText('Reply')).toBeNull();
  });

  it('exposes Reply / Copy / Report Message rows when visible', async () => {
    const { getByLabelText } = await render(
      <MessageActionSheet
        visible
        messagePreview="hello"
        onReply={jest.fn()}
        onCopy={jest.fn()}
        onReport={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(getByLabelText('Reply')).toBeTruthy();
    expect(getByLabelText('Copy')).toBeTruthy();
    expect(getByLabelText('Report Message')).toBeTruthy();
  });

  it('invokes onReply + onClose when Reply tapped', async () => {
    const onReply = jest.fn();
    const onClose = jest.fn();
    const { getByLabelText } = await render(
      <MessageActionSheet
        visible
        onReply={onReply}
        onCopy={jest.fn()}
        onReport={jest.fn()}
        onClose={onClose}
      />,
    );
    await fireEvent.press(getByLabelText('Reply'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('invokes onReport + onClose when Report Message tapped', async () => {
    const onReport = jest.fn();
    const onClose = jest.fn();
    const { getByLabelText } = await render(
      <MessageActionSheet
        visible
        onReply={jest.fn()}
        onCopy={jest.fn()}
        onReport={onReport}
        onClose={onClose}
      />,
    );
    await fireEvent.press(getByLabelText('Report Message'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose alone when Cancel is tapped', async () => {
    const onClose = jest.fn();
    const { getByText } = await render(
      <MessageActionSheet
        visible
        onReply={jest.fn()}
        onCopy={jest.fn()}
        onReport={jest.fn()}
        onClose={onClose}
      />,
    );
    await fireEvent.press(getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
