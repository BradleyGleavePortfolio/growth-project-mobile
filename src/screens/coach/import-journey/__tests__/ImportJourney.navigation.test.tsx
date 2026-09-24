import './sideEffectGuards.cjs';
import React, { useEffect, useState } from 'react';
import { BackHandler, ScrollView, Text } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { ImportOfferCard } from '../ImportOfferCard';
import { ImportSetupView } from '../ImportSetupView';
import { findImportPlatform } from '../../../../constants/importPlatforms';
import { safeImportLoginUrl } from '../../../../utils/safeImportLoginUrl';
const guards = require('./sideEffectGuards.cjs');

type LocalStep = 'question' | 'value' | 'source' | 'customSource' | 'computerHandoff' | 'home';
/** Test-only, in-memory host; never exported or registered in a navigator. */
function LocalTraversalHost({ onExit }: { onExit: (reason: 'fresh' | 'later') => void }) {
  const [step, setStep] = useState<LocalStep>('question');
  const [selectedSourceId, setSource] = useState<string | null>(null);
  const [customSourceUrl, setUrl] = useState('');
  const [validation, setValidation] = useState<'idle' | 'invalid'>('idle');
  const [deferred, setDeferred] = useState(false);
  const back = () => {
    if (step === 'computerHandoff') setStep(selectedSourceId === 'custom' ? 'customSource' : 'source');
    else if (step === 'customSource') setStep('source');
    else if (step === 'source') setStep('value');
    else if (step === 'value') setStep('question');
    else setStep('home');
  };
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 'home') return false;
      back();
      return true;
    });
    return () => listener.remove();
  });
  const exit = (reason: 'fresh' | 'later') => {
    setDeferred(reason === 'later');
    setStep('home');
    onExit(reason);
  };
  const onLater = () => exit('later');
  if (step === 'home') return <ScrollView>
    <Text>Mock coaching home</Text>
    {deferred && <ImportOfferCard variant="resume" romanEnabled onResume={() => setStep('source')} />}
  </ScrollView>;
  if (step === 'question' || step === 'value') return <ScrollView>
    {step === 'question'
      ? <ImportOfferCard variant="question" romanEnabled onYes={() => setStep('value')} onStartingFresh={() => exit('fresh')} onLater={onLater} />
      : <ImportOfferCard variant="value" romanEnabled onImportRecords={() => setStep('source')} onBack={back} onLater={onLater} />}
  </ScrollView>;
  if (step === 'computerHandoff') return <ImportSetupView step="computerHandoff" selectedSourceId={selectedSourceId!} romanEnabled focusOnMount onBack={back} onLater={onLater} />;
  const inputs = {
    romanEnabled: true, focusOnMount: true, selectedSourceId, customSourceUrl, validation,
    onBack: back, onLater,
    onSourceChange: (id: string) => { setSource(id); setStep(id === 'custom' ? 'customSource' : 'source'); },
    onCustomSourceChange: (text: string) => { setUrl(text); setValidation('idle'); },
    onCustomSourceBlur: () => setValidation(safeImportLoginUrl(customSourceUrl) ? 'idle' : 'invalid'),
    onContinue: () => {
      if (step === 'source' && selectedSourceId === 'custom') setStep('customSource');
      else if (selectedSourceId && findImportPlatform(selectedSourceId) && (selectedSourceId !== 'custom' || safeImportLoginUrl(customSourceUrl))) setStep('computerHandoff');
    },
  };
  return step === 'customSource'
    ? <ImportSetupView {...inputs} step="customSource" selectedSourceId="custom" />
    : <ImportSetupView {...inputs} step="source" />;
}

let hardwareBack: (() => boolean | null | undefined) | undefined;
beforeEach(() => {
  guards.installGuards();
  hardwareBack = undefined;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, callback) => {
    hardwareBack = callback;
    return { remove: jest.fn() };
  });
});
afterEach(async () => {
  await cleanup();
  try { guards.assertNoSideEffects(); } finally { jest.restoreAllMocks(); }
});

it('verifies that every forbidden side-effect guard really throws', () => guards.exerciseGuards());

it('traverses Yes → value → source → handoff, with equivalent header/hardware Back and retained selection', async () => {
  const onExit = jest.fn();
  const view = await render(<LocalTraversalHost onExit={onExit} />);
  const press = async (name: string) => fireEvent.press(view.getByRole('button', { name }));
  await press('Yes');
  expect(view.getByRole('header')).toHaveTextContent('Would you like to bring your clients and coaching history into TGP?');
  await press('Import my records');
  await fireEvent.press(view.getByRole('radio', { name: 'TrueCoach' }));
  await press('Continue');
  expect(view.getByRole('header')).toHaveTextContent('Continue on a computer');
  await press('Back');
  expect(view.getByRole('radio', { name: 'TrueCoach' }).props.accessibilityState.checked).toBe(true);
  await press('Continue');
  await act(() => { expect(hardwareBack?.()).toBe(true); });
  expect(view.getByRole('radio', { name: 'TrueCoach' }).props.accessibilityState.checked).toBe(true);
  await press('Back');
  expect(view.getByRole('header')).toHaveTextContent('Would you like to bring your clients and coaching history into TGP?');
  await press('Back');
  expect(view.getByRole('header')).toHaveTextContent('Have you coached on another platform before?');
  expect(onExit).not.toHaveBeenCalled();
});

it('retains custom input, gives inline feedback, and only advances a valid address to instructions', async () => {
  const view = await render(<LocalTraversalHost onExit={jest.fn()} />);
  for (const name of ['Yes', 'Import my records']) await fireEvent.press(view.getByRole('button', { name }));
  await fireEvent.press(view.getByRole('radio', { name: 'Custom / Other' }));
  await fireEvent.changeText(view.getByLabelText('Site address'), 'http://127.0.0.1');
  await fireEvent(view.getByLabelText('Site address'), 'blur');
  expect(view.getByRole('alert')).toHaveTextContent('Enter a valid public HTTPS address.');
  expect(view.getByRole('button', { name: 'Continue' })).toBeDisabled();
  const address = 'https://coaching.example.com/login?private=never-display-in-handoff';
  await fireEvent.changeText(view.getByLabelText('Site address'), address);
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  expect(view.getByRole('header')).toHaveTextContent('Continue on a computer');
  expect(view.queryByText(/never-display/)).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Back' }));
  expect(view.getByLabelText('Site address').props.value).toBe(address);
  await fireEvent.press(view.getByRole('button', { name: 'Back' }));
  expect(view.queryByLabelText('Site address')).toBeNull();
  expect(view.getByRole('radio', { name: 'Custom / Other' }).props.accessibilityState.checked).toBe(true);
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  expect(view.getByLabelText('Site address').props.value).toBe(address);
});

it.each(['question', 'value', 'source', 'customSource', 'computerHandoff'] as const)('Later exits %s only to the mock host, with no saved claim', async target => {
  const onExit = jest.fn();
  const view = await render(<LocalTraversalHost onExit={onExit} />);
  if (target !== 'question') await fireEvent.press(view.getByRole('button', { name: 'Yes' }));
  if (!['question', 'value'].includes(target)) await fireEvent.press(view.getByRole('button', { name: 'Import my records' }));
  if (target === 'customSource') await fireEvent.press(view.getByRole('radio', { name: 'Custom / Other' }));
  if (target === 'computerHandoff') {
    await fireEvent.press(view.getByRole('radio', { name: 'Everfit' }));
    await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  }
  await fireEvent.press(view.getByRole('button', { name: target === 'computerHandoff' ? 'I will use a computer later' : 'Later' }));
  expect(view.getByText('Mock coaching home')).toBeTruthy();
  expect(onExit.mock.calls).toEqual([['later']]);
  expect(view.queryByText(/saved|copied|running|complete/i)).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Continue import setup' }));
  expect(view.getByRole('header')).toHaveTextContent('Where are your records?');
  expect(onExit.mock.calls).toEqual([['later']]);
});

it('starting fresh exits once and leaves normal mock coaching home, without a promotion', async () => {
  const onExit = jest.fn();
  const view = await render(<LocalTraversalHost onExit={onExit} />);
  await fireEvent.press(view.getByRole('button', { name: 'I am starting fresh' }));
  expect(view.getByText('Mock coaching home')).toBeTruthy();
  expect(view.queryByRole('button')).toBeNull();
  expect(onExit.mock.calls).toEqual([['fresh']]);
});
