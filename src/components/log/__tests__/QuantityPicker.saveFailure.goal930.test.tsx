// GOAL-930-M (D4, C2 Style C C_error, owner #203-E50 "op 1 to all"; C2 index.md :396 "an inline message keeps the
// foods on screen. All styles draw it inline."): a failed save from the portion sheet shows in the sheet as the drawn
// card (C_error.html :137-138 .c-err: a 3 pt left edge in --warnink, fill --warnbg, corners 0 12 12 0, padding 10 12,
// margin 10 0, Inter 15/21.75, the title bold on its own line), announced once as an alert (C2 index.md :133), and
// the primary reads "Try again" (C2-S-19) and repeats the action that failed. One new optional prop, `saveFailure`,
// passed only by the Food tab; absent, the sheet draws as at main, and so does the coach's meal picker
// (MealPickerScreen.tsx:157-160), which passes confirmLabel and its own failure as `notice`.
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import QuantityPickerModal, { QuantityPickerContent } from '../QuantityPickerModal';
import { colors } from '../../../theme/tokens';
import type { SearchResult } from '../../../utils/log/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const chicken: SearchResult = {
  id: 'usda-1', name: 'Chicken breast, grilled', calories: 165, protein: 31, carbs: 0, fat: 3.6, nutrient_basis: 'PER_100G',
};
const LOG_FAILED = { title: "Couldn't log food", message: 'This food was not added. Check the connection and try again.' };
type Failure = React.ComponentProps<typeof QuantityPickerContent> extends { saveFailure?: infer F } ? F : never;
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) ?? {};

function Sheet(p: { failure?: Failure; onConfirm?: () => void; onAddAnother?: () => void }) {
  const [qty, setQty] = useState('150');
  const extra = p.failure === undefined ? {} : { saveFailure: p.failure };
  return (
    <QuantityPickerContent selectedFood={chicken} quantityInput={qty} selectedUnit="g" mealLabel="Lunch"
      onQuantityChange={setQty} onUnitChange={jest.fn()} onCancel={jest.fn()} onConfirm={p.onConfirm ?? jest.fn()}
      onAddAnother={p.onAddAnother} dayLeft={{ kcal: 640, protein: 63 }}
      confirmLabel={p.failure ? 'Try again' : undefined} {...extra} />
  );
}

describe('GOAL-930-M D4: the save failure as the drawn card in the portion sheet', () => {
  it('draws .c-err from tokens: edge, fill, corners, padding, margin and type (C_error.html :137-138)', async () => {
    await render(<Sheet failure={{ ...LOG_FAILED, retry: 'confirm' }} />);
    const card = screen.getByTestId('portion-save-failure');
    expect(flat(card)).toEqual(expect.objectContaining({
      borderLeftWidth: 3, borderLeftColor: colors.warningInk, backgroundColor: colors.warningBg,
      borderTopRightRadius: 12, borderBottomRightRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginVertical: 10,
    }));
    // corners 0 12 12 0: the left corners stay square against the edge.
    expect(flat(card).borderRadius ?? 0).toBe(0);
    expect(flat(card).borderTopLeftRadius ?? 0).toBe(0);
    expect(flat(card).borderBottomLeftRadius ?? 0).toBe(0);
    const title = within(card).getByText(LOG_FAILED.title);
    const body = within(card).getByText(LOG_FAILED.message);
    expect(title).not.toBe(body); // the title on its own line (.c-err b{display:block})
    for (const t of [title, body]) {
      expect(flat(t)).toEqual(expect.objectContaining({ fontSize: 15, lineHeight: 21.75 }));
      expect(String(flat(t).fontFamily)).toMatch(/^Inter_/);
    }
    expect(flat(title).fontFamily).toBe('Inter_600SemiBold');
    expect(flat(body).fontFamily).toBe('Inter_400Regular');
  });

  it('is announced once as an alert, and the sheet keeps the portion on screen', async () => {
    await render(<Sheet failure={{ ...LOG_FAILED, retry: 'confirm' }} />);
    expect(screen.getByTestId('portion-save-failure').props.accessibilityRole).toBe('alert');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByLabelText('Food quantity').props.value).toBe('150');
  });

  it('the primary reads "Try again" and calls onConfirm exactly once after a Log food failure', async () => {
    const onConfirm = jest.fn();
    const onAddAnother = jest.fn();
    await render(<Sheet failure={{ ...LOG_FAILED, retry: 'confirm' }} onConfirm={onConfirm} onAddAnother={onAddAnother} />);
    expect(screen.queryByRole('button', { name: 'Log food' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onAddAnother).not.toHaveBeenCalled();
  });

  it('after an Add another food failure, Try again repeats Add another food, exactly once', async () => {
    const onConfirm = jest.fn();
    const onAddAnother = jest.fn();
    await render(<Sheet failure={{ ...LOG_FAILED, retry: 'addAnother' }} onConfirm={onConfirm} onAddAnother={onAddAnother} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onAddAnother).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('the offline path\'s words show the same way', async () => {
    await render(<Sheet failure={{ title: "Couldn't save food", message: 'Keep this portion open and try saving again.', retry: 'confirm' }} />);
    const card = screen.getByTestId('portion-save-failure');
    expect(within(card).getByText("Couldn't save food")).toBeTruthy();
    expect(within(card).getByText('Keep this portion open and try saving again.')).toBeTruthy();
  });

  it('no Keep on plate for later and no photo: features phone main does not have', async () => {
    await render(<Sheet failure={{ ...LOG_FAILED, retry: 'confirm' }} />);
    expect(screen.queryByText(/Keep on plate for later/i)).toBeNull();
    expect(screen.queryByLabelText(/Keep on plate for later/i)).toBeNull();
    expect(screen.queryAllByTestId(/photo/i)).toHaveLength(0);
  });
});

describe('GOAL-930-M D4: with the prop absent the sheet draws as at main', () => {
  it('absent and null draw the same tree, with no card, no alert and main\'s Log food', async () => {
    const absent = await render(<Sheet />);
    const a = JSON.stringify(absent.toJSON());
    expect(screen.queryByTestId('portion-save-failure')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Log food' })).toBeTruthy();
    absent.unmount();
    const nulled = await render(<Sheet failure={null} />);
    expect(JSON.stringify(nulled.toJSON())).toBe(a);
  });

  it('the coach\'s meal picker sheet (MealPickerScreen.tsx:157-160) draws as at main: its notice, its words, no card', async () => {
    const onConfirm = jest.fn();
    await render(
      <QuantityPickerModal visible selectedFood={chicken} quantityInput="150" selectedUnit="g" onQuantityChange={jest.fn()}
        onUnitChange={jest.fn()} onConfirm={onConfirm} onCancel={jest.fn()} saving={false} mealLabel="Pre-workout"
        confirmLabel="Use this food" emptyHint="Enter a quantity greater than zero to use this food." blocked={false}
        notice="The food could not be saved. Check the connection and try again." />,
    );
    expect(screen.queryByTestId('portion-save-failure')).toBeNull();
    const notice = screen.getByRole('alert');
    expect(notice.props.children).toBe('The food could not be saved. Check the connection and try again.');
    expect(flat(notice)).toEqual(expect.objectContaining({ fontSize: 14, lineHeight: 20.02, marginTop: 4 }));
    expect(screen.getByText('Cancel')).toBeTruthy();
    const use = screen.getByRole('button', { name: 'Use this food' });
    // main's quantityLogButton margin (10 above) whenever a notice shows.
    expect(flat(screen.getByTestId('quantity-log-food'))).toEqual(expect.objectContaining({ marginTop: 10 }));
    await fireEvent.press(use);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
