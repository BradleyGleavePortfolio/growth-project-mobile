/**
 * FIX-931 (LS-931 B2 as a class, classic log): a food saved offline carries the C2 Style C offline line,
 * its tap opens its one action (Remove) rather than doing nothing, and a refused food shows no number.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import MealSectionCard from '../MealSectionCard';
import type { FoodLog } from '../../../types';

const log = (over: Partial<FoodLog>): FoodLog => ({
  id: 'l1', userId: 'u1', coachId: '', date: '2026-11-04', mealType: 'breakfast', foodName: 'Rolled oats',
  calories: 150, protein: 5, carbs: 27, fat: 3, quantity: 1, unit: 'serving', createdAt: '2026-11-04T08:00:00Z',
  ...over,
});

const base = { label: 'Breakfast', mealType: 'breakfast' as const, mealCalories: 150, onAddPress: jest.fn() };

it('a waiting food reads with the drawn line and its tap opens Remove', async () => {
  const onDeletePress = jest.fn();
  const onEditPress = jest.fn();
  const waiting = log({ id: 'pfl-1', clientUuid: 'pfl-1', offline: 'waiting' });
  await render(<MealSectionCard {...base} logs={[waiting]} onDeletePress={onDeletePress} onEditPress={onEditPress} />);
  expect(screen.getByTestId('food-offline-pfl-1').props.children).toBe('Saved offline. Rolled oats will sync when you reconnect.');
  expect(screen.getByText('150')).toBeTruthy();
  await fireEvent.press(screen.getByText('Rolled oats'));
  expect(onDeletePress).toHaveBeenCalledWith(waiting);
  expect(onEditPress).not.toHaveBeenCalled();
});

it('a refused food is marked, shows no number, and its tap opens Remove', async () => {
  const onDeletePress = jest.fn();
  const refused = log({ id: 'pfl-2', clientUuid: 'pfl-2', offline: 'refused' });
  await render(<MealSectionCard {...base} mealCalories={0} logs={[refused]} onDeletePress={onDeletePress} />);
  expect(screen.getByTestId('food-offline-pfl-2').props.children).toBe("Couldn't log food");
  expect(screen.queryByText('150')).toBeNull();
  await fireEvent.press(screen.getByText('Rolled oats'));
  expect(onDeletePress).toHaveBeenCalledWith(refused);
});

it('a synced food keeps tap to edit', async () => {
  const onEditPress = jest.fn();
  const synced = log({});
  await render(<MealSectionCard {...base} logs={[synced]} onDeletePress={jest.fn()} onEditPress={onEditPress} />);
  expect(screen.queryByTestId('food-offline-l1')).toBeNull();
  await fireEvent.press(screen.getByText('Rolled oats'));
  expect(onEditPress).toHaveBeenCalledWith(synced);
});
