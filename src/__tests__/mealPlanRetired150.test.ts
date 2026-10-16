/**
 * MEALPLAN-RETIRE (owner: "mealplan-tab - remove the old stuff"): no app
 * source calls the old meal-plan endpoints. Meal plans reach the app only
 * through the day plan (src/api/mealTemplatesApi.ts).
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..');
const sources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(file);
  return /\.(js|ts|tsx)$/.test(entry.name) ? [file] : [];
});
const FILES = sources(SRC).map((file) => [path.relative(SRC, file), fs.readFileSync(file, 'utf8')] as const);

it.each([
  ['coach list and create', /['"`]\/coach\/clients\/\$\{\w+\}\/meal-plans['"`]/],
  ['coach update and archive', /['"`]\/coach\/meal-plans\//],
  ['coach AI free-form meal plan', /['"`]\/coach\/ai\/meal-plan['"`]/],
])('no app source calls the old %s endpoint', (_name, endpoint) => {
  expect(FILES.filter(([, src]) => endpoint.test(src)).map(([file]) => file)).toEqual([]);
  expect(FILES.length).toBeGreaterThan(100);
});
