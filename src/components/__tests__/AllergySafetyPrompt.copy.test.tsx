// ALLERGY-128 — the allergy prompt must not promise filtering that does not exist.
// ALLERGY-M-130 — once the backend hides shared recipes by declared allergens (rule 'on', read from
// GET /recipes/allergens by the caller), the prompt says so; without the rule ('off', the default) it keeps
// the copy below; unconfirmed ('unknown') it claims neither. Every state keeps the check-ingredients line.
//
// Evidence (backend main 0d179edb): GET /recipes (src/recipes/recipes.service.ts
// list -> visibleRecipesWhere in recipe-access.ts) selects recipes by creator and
// coach tenancy only; nothing reads the client's dietary_restrictions. The mobile
// RecipesScreen filters by search and tag only. So the prompt may say the answer
// is saved to the profile, must tell the client to check ingredients, and must
// never say recipes are hidden or filtered for them.

import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import AllergySafetyPrompt from '../AllergySafetyPrompt';

function collect(node: unknown, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return;
  }
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (typeof node === 'object' && 'children' in node) {
    collect((node as { children: unknown }).children, out);
  }
}

function allText(): string {
  const out: string[] = [];
  collect(screen.toJSON(), out);
  return out.join(' ').replace(/\s+/g, ' ');
}

async function renderPrompt(rule?: 'on' | 'off' | 'unknown') {
  const onDismiss = jest.fn();
  const onSubmit = jest.fn();
  const onLater = jest.fn();
  await render(
    <AllergySafetyPrompt
      visible
      onDismiss={onDismiss}
      onSubmit={onSubmit}
      onLater={onLater}
      rule={rule}
    />,
  );
  return { onDismiss, onSubmit, onLater };
}

describe('AllergySafetyPrompt copy (ALLERGY-128)', () => {
  it('never promises that recipes are hidden or filtered', async () => {
    await renderPrompt();
    const text = allText();
    expect(text).not.toMatch(/\bhide|\bhidden|\bconflict/i);
    expect(text).not.toMatch(/\bwill (filter|remove|exclude)/i);
    expect(text).not.toMatch(/\byet\b/i);
  });

  it('says plainly that recipes are not filtered and to check ingredients', async () => {
    await renderPrompt();
    const text = allText();
    expect(text).toContain('This is saved to your profile.');
    expect(text).toContain('Recipes are not filtered by it');
    expect(text).toContain("check each recipe's ingredients before you cook");
  });

  it.each([undefined, 'on', 'off', 'unknown'] as const)('uses no first person or exclamation in product copy (%s)', async (rule) => {
    await renderPrompt(rule);
    expect(allText()).not.toMatch(/\b(we|our|us|I|my)\b/i);
    expect(allText()).not.toContain('!');
    expect(allText()).toMatch(/check each recipe's ingredients before you cook/i);
  });

  it('says hiding is on only for rule on, and that undeclared recipes and diets do not hide', async () => {
    await renderPrompt('on');
    const text = allText();
    expect(text).toContain('Recipes that list an allergen you choose are hidden.');
    expect(text).toContain('Vegetarian, Vegan and Pescatarian are saved but do not hide recipes.');
    expect(text).toContain('Recipes without declared allergens still show');
    expect(text).not.toMatch(/not filtered/);
  });

  it('claims neither hiding nor no filtering while the rule is unconfirmed', async () => {
    await renderPrompt('unknown');
    const text = allText();
    expect(text).toContain('This is saved to your profile.');
    expect(text).not.toMatch(/\bhid(e|den)\b|not filtered/i);
  });

  it('keeps save, later and dismiss working', async () => {
    const { onDismiss, onSubmit, onLater } = await renderPrompt();
    await fireEvent.press(screen.getByLabelText('Nut Allergy'));
    await fireEvent.press(screen.getByLabelText('Save restrictions'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(['Nut Allergy']));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));

    await fireEvent.press(screen.getByLabelText('Set this up later'));
    await waitFor(() => expect(onLater).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(2));
  });

  // ALLERGY-CHOICES-131: Soy and Sesame were missing, so a sesame allergy could not be saved. They are saved
  // as shown, the allergen names the backend maps (src/recipes/allergens.ts 'soy' / 'sesame').
  it('offers Soy and Sesame beside every earlier choice and saves them as shown', async () => {
    const { onSubmit } = await renderPrompt('on');
    for (const label of ['None', 'Nut Allergy', 'Peanut Allergy', 'Shellfish Allergy', 'Egg Allergy', 'Dairy Allergy',
      'Soy', 'Sesame', 'Gluten-Free', 'Vegetarian', 'Vegan', 'Pescatarian']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    await fireEvent.press(screen.getByLabelText('Sesame'));
    await fireEvent.press(screen.getByLabelText('Soy'));
    expect(screen.getByLabelText('Sesame').props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByLabelText('Save restrictions'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(['Sesame', 'Soy']));
  });

  it('saves None as an empty list', async () => {
    const { onSubmit } = await renderPrompt();
    await fireEvent.press(screen.getByLabelText('None'));
    await fireEvent.press(screen.getByLabelText('Save restrictions'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith([]));
  });
});
