import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RecipesScreen from '../RecipesScreen';
import RecipeDetailScreen from '../RecipeDetailScreen';
import PrepGuideScreen from '../PrepGuideScreen';

// ALLERGY-M-130: the app half of allergy filtering. The backend (CF-ALLERGY-128) hides a shared recipe only when its
// author declared an allergen saved on the client's profile; the app repeats what was declared, labels the rest
// "Allergens not declared", says hiding is on only when GET /recipes/allergens answers, and drops recipes the
// server now refuses.
const mockNavigate = jest.fn(), mockBack = jest.fn();
const mockList = jest.fn(), mockListSaved = jest.fn(), mockGetById = jest.fn(), mockAllergens = jest.fn();
const mockUpdate = jest.fn(async (_body: unknown) => ({})), mockGuide = jest.fn();
let mockRestrictions: string[] | undefined = [];
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockBack, navigate: mockNavigate }), useRoute: () => ({ params: { recipeId: 'satay' } }) }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens, colors: new Proxy({}, { get: () => 'legacy' }) }) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client', profile: { diet_restrictions: mockRestrictions } }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/api', () => ({
  recipesApi: {
    list: () => mockList(), listSaved: () => mockListSaved(), getById: (id: string) => mockGetById(id),
    allergens: () => mockAllergens(), save: async () => ({}), unsave: async () => ({}),
  },
  profileApi: { update: (body: unknown) => mockUpdate(body) },
  prepGuideApi: { getWeeklyGuide: () => mockGuide() },
  listsApi: { bulkAdd: jest.fn() },
}));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const base = { calories: 320, protein: 24, carbs: 40, fat: 8, prep_time_min: 5, cook_time_min: 20, servings: 2, ingredients: ['Rice'], instructions: ['Cook.'], tags: [], is_public: true, created_by_id: 'coach', _count: { saved_by: 0 } };
const satay = { ...base, id: 'satay', title: 'Peanut satay', allergens: ['peanuts', 'tree_nuts'], allergens_declared: true };
const rice = { ...base, id: 'rice', title: 'Plain rice', allergens: [], allergens_declared: true };
const pesto = { ...base, id: 'pesto', title: 'Pesto pasta', allergens: ['dairy'], allergens_declared: false };
const noodles = { ...base, id: 'noodles', title: 'Noodles', allergens: [], allergens_declared: false };
const legacy = { ...base, id: 'legacy', title: 'Lentil soup' }; // a backend before the allergen rule sends neither field
const list9 = ['peanuts', 'tree_nuts', 'dairy', 'eggs', 'fish', 'shellfish', 'soy', 'sesame', 'gluten'].map((code) => ({ code, label: code }));
const guideOn = (yours: string[]) => ({ data: { allergens: list9, your_allergens: yours } });
const notFound = { response: { status: 404, data: { error: 'RECIPE_NOT_FOUND' } } };
const hidden = { response: { status: 404, data: { code: 'RECIPE_HIDDEN_FOR_ALLERGENS', error: 'RECIPE_HIDDEN_FOR_ALLERGENS', message: 'hidden' } } };

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const mount = (client: QueryClient, el: React.ReactElement) => render(<QueryClientProvider client={client}>{el}</QueryClientProvider>);
let storageSpy: jest.SpyInstance | undefined;
function leanFirstOpen() {
  mockRestrictions = undefined;
  storageSpy = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key) => (key === 'lean_onboarding_done' ? 'true' : null));
}
afterEach(() => { storageSpy?.mockRestore(); storageSpy = undefined; });
beforeEach(() => {
  jest.clearAllMocks();
  mockRestrictions = [];
  mockUpdate.mockResolvedValue({});
  mockList.mockResolvedValue({ data: [satay, rice, pesto, noodles, legacy] });
  mockListSaved.mockResolvedValue({ data: [] });
  mockGetById.mockResolvedValue({ data: { ...satay, isSaved: false } });
  mockAllergens.mockResolvedValue(guideOn([]));
});

describe('recipe rows say only what the author declared', () => {
  it('labels declared, declared-free, partly declared, undeclared and pre-rule recipes', async () => {
    const ui = await mount(newClient(), <RecipesScreen />);
    expect(await ui.findByText('Contains peanuts and tree nuts')).toBeTruthy();
    expect(ui.getByText('Declared free of 9 common allergens')).toBeTruthy();
    expect(ui.getByText('Contains dairy; other allergens not declared')).toBeTruthy();
    expect(ui.getAllByText('Allergens not declared')).toHaveLength(2); // noodles and the pre-rule lentil soup
    await fireEvent.press(ui.getByRole('button', { name: 'Open Peanut satay' }));
    expect(mockNavigate).toHaveBeenCalledWith('RecipeDetail', { recipeId: 'satay' });
  });

  it('says which saved allergens hide recipes only when the server confirms it', async () => {
    mockAllergens.mockResolvedValue(guideOn(['peanuts', 'tree_nuts']));
    const on = await mount(newClient(), <RecipesScreen />);
    expect(await on.findByText('Recipes that list peanuts or tree nuts are hidden.')).toBeTruthy();
    await on.unmount();
    const answers = [async () => guideOn([]), async () => { throw notFound; }, async () => { throw new Error('Network Error'); }];
    for (const answer of answers) {
      mockAllergens.mockImplementation(answer);
      const ui = await mount(newClient(), <RecipesScreen />);
      await ui.findByText('Plain rice');
      await waitFor(() => expect(mockAllergens).toHaveBeenCalled());
      expect(ui.queryByText(/are hidden/)).toBeNull();
      await ui.unmount();
      mockAllergens.mockClear();
    }
  });
});

describe('the one-time allergy prompt follows the server', () => {
  const lede = async (ui: Awaited<ReturnType<typeof mount>>) => {
    await ui.findByRole('button', { name: 'Set this up later' });
    return ui.getByText(/saved to your profile/).props.children as string;
  };

  it('promises hiding only when GET /recipes/allergens answers, and waits for that answer', async () => {
    leanFirstOpen();
    let answer: (value: unknown) => void = () => {};
    mockAllergens.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const ui = await mount(newClient(), <RecipesScreen />);
    await ui.findByText('Plain rice');
    expect(ui.queryByRole('button', { name: 'Set this up later' })).toBeNull();
    answer(guideOn([]));
    const text = (await lede(ui)).replace(/\s+/g, ' ');
    expect(text).toContain('Recipes that list an allergen you choose are hidden.');
    expect(text).toContain('Vegetarian, Vegan and Pescatarian are saved but do not hide recipes.');
    expect(text).toContain("Recipes without declared allergens still show, so check each recipe's ingredients before you cook.");
  });

  it('keeps saying recipes are not filtered on a backend without the rule, and claims nothing when unconfirmed', async () => {
    leanFirstOpen();
    mockAllergens.mockRejectedValue(notFound);
    const off = await mount(newClient(), <RecipesScreen />);
    const offText = (await lede(off)).replace(/\s+/g, ' ');
    expect(offText).toContain("Recipes are not filtered by it, so check each recipe's ingredients before you cook.");
    expect(offText).not.toMatch(/hidden/);
    await off.unmount();
    mockAllergens.mockRejectedValue({ response: { status: 503 } });
    const unknown = await mount(newClient(), <RecipesScreen />);
    const unknownText = (await lede(unknown)).replace(/\s+/g, ' ');
    expect(unknownText).toContain("Check each recipe's ingredients before you cook.");
    expect(unknownText).not.toMatch(/hidden|not filtered/);
  });

  it('reads the library again after the answer is saved, so newly hidden recipes leave it', async () => {
    leanFirstOpen();
    const client = newClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const ui = await mount(client, <RecipesScreen />);
    await ui.findByRole('button', { name: 'Set this up later' });
    expect(ui.getByText('Peanut satay')).toBeTruthy();
    mockList.mockResolvedValue({ data: [rice, pesto, noodles, legacy] });
    mockAllergens.mockResolvedValue(guideOn(['peanuts', 'tree_nuts']));
    await fireEvent.press(ui.getByRole('button', { name: 'Nut Allergy' }));
    await fireEvent.press(ui.getByRole('button', { name: 'Save restrictions' }));
    expect(mockUpdate).toHaveBeenCalledWith({ diet_restrictions: ['Nut Allergy'] });
    await waitFor(() => expect(ui.queryByText('Peanut satay')).toBeNull());
    expect(await ui.findByText('Recipes that list peanuts or tree nuts are hidden.')).toBeTruthy();
    for (const queryKey of [['recipes'], ['recipe'], ['prep-guide']]) expect(invalidate).toHaveBeenCalledWith({ queryKey });
  });
});

describe('recipe detail', () => {
  it('shows the declared allergens and keeps the check-ingredients line', async () => {
    const ui = await mount(newClient(), <RecipeDetailScreen />);
    expect(await ui.findByText('Contains peanuts and tree nuts.')).toBeTruthy();
    expect(ui.getByText('ALLERGENS')).toBeTruthy();
    expect(ui.getByText('Check the ingredients below before you cook.')).toBeTruthy();
    await ui.unmount();
    mockGetById.mockResolvedValue({ data: { ...rice, id: 'satay', isSaved: false } });
    const free = await mount(newClient(), <RecipeDetailScreen />);
    expect(await free.findByText('Declared free of peanuts, tree nuts, dairy, eggs, fish, shellfish, soy, sesame and gluten.')).toBeTruthy();
    await free.unmount();
    mockGetById.mockResolvedValue({ data: { ...legacy, id: 'satay', isSaved: false } });
    const old = await mount(newClient(), <RecipeDetailScreen />);
    expect(await old.findByText('Allergens not declared.')).toBeTruthy();
  });

  it('drops a cached copy the server now hides for a saved allergen, with no retry', async () => {
    const client = newClient();
    client.setQueryData(['recipes'], [satay]);
    mockGetById.mockRejectedValue(hidden);
    const ui = await mount(client, <RecipeDetailScreen />);
    expect(await ui.findByText('This recipe is hidden because it lists an allergen saved on your profile.')).toBeTruthy();
    expect(ui.queryByText('Peanut satay')).toBeNull();
    expect(ui.queryByRole('button', { name: 'Retry recipe' })).toBeNull();
    await fireEvent.press(ui.getByRole('button', { name: 'Go back' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('drops a cached copy of a recipe that is gone, but keeps it through a failed connection', async () => {
    const gone = newClient();
    gone.setQueryData(['recipes'], [satay]);
    mockGetById.mockRejectedValue(notFound);
    const ui = await mount(gone, <RecipeDetailScreen />);
    expect(await ui.findByText('This recipe is no longer available.')).toBeTruthy();
    expect(ui.queryByText('Peanut satay')).toBeNull();
    await ui.unmount();
    const offline = newClient();
    offline.setQueryData(['recipes'], [satay]);
    mockGetById.mockRejectedValue(new Error('Network Error'));
    const kept = await mount(offline, <RecipeDetailScreen />);
    await waitFor(() => expect(mockGetById).toHaveBeenCalled());
    expect(await kept.findByText('Peanut satay')).toBeTruthy();
    expect(kept.getByText('Contains peanuts and tree nuts.')).toBeTruthy();
  });
});

it('prep guide recipe rows carry the same allergen line', async () => {
  mockGuide.mockResolvedValue({ data: { recipes: [satay, legacy], aggregated_ingredients: [], prep_day_suggestions: [], source: 'library' } });
  const ui = await mount(newClient(), <PrepGuideScreen />);
  expect(await ui.findByText('Contains peanuts and tree nuts')).toBeTruthy();
  expect(ui.getByText('Allergens not declared')).toBeTruthy();
  await fireEvent.press(ui.getByRole('button', { name: 'Open Peanut satay' }));
  expect(mockNavigate).toHaveBeenCalledWith('RecipeDetail', { recipeId: 'satay' });
});
