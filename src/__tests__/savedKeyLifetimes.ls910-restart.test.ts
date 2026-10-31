/**
 * Run the reviewed contract unchanged, then require evidence that it actually
 * reopened one of its registered queues. A static getItem call in the source
 * is not evidence that a restart restores the saved work.
 */
jest.mock('../storage/autosaveMirror', () => {
  const actual = jest.requireActual<typeof import('../storage/autosaveMirror')>('../storage/autosaveMirror');
  return { ...actual, readAutosaveMirror: jest.fn(actual.readAutosaveMirror) };
});

import { readAutosaveMirror } from '../storage/autosaveMirror';
import './savedKeyLifetimes.test';

it('LS-910 B3 shared lifetime case exercises the registered restart reader', () => {
  expect(readAutosaveMirror).toHaveBeenCalled();
});
