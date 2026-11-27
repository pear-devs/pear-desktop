import { expect, test } from '@playwright/test';

import {
  isContentWarningText,
  shouldAcknowledge,
  warningScreenKey,
} from './matcher';

const WARNING_REASON =
  'The following content may contain suicide or self-harm topics.';

test('matches the English suicide/self-harm interstitial', () => {
  expect(
    isContentWarningText(
      WARNING_REASON,
      'Viewer discretion is advised. Learn more',
    ),
  ).toBe(true);
});

test('matches accented and non-English warning copy', () => {
  expect(
    isContentWarningText(
      'O conteúdo a seguir pode conter tópicos sobre suicídio ou automutilação',
    ),
  ).toBe(true);
  expect(
    isContentWarningText(
      'Die folgenden Inhalte können Themen wie Selbstmord oder Selbstverletzung enthalten',
    ),
  ).toBe(true);
  expect(
    isContentWarningText(
      'Seuraava sisältö saattaa sisältää itsemurhaan tai itsensä vahingoittamiseen liittyviä aiheita.',
    ),
  ).toBe(true);
  expect(
    isContentWarningText(
      '다음 콘텐츠에는 자살 또는 자해 주제가 포함될 수 있습니다.',
    ),
  ).toBe(true);
});

test('does not match generic playability errors or age gates', () => {
  const negatives = [
    'Video unavailable',
    'This video is private',
    'Sign in to confirm your age',
    'This video may be inappropriate for some users.',
    'Playback on other websites has been disabled by the video owner',
    'YouTube Premium',
    'Get YouTube Premium',
    'Sign in to confirm you’re not a bot',
    '',
  ];
  for (const reason of negatives) {
    expect(
      shouldAcknowledge({
        reason,
        subreason: '',
        hasProceedButton: true,
      }),
      reason,
    ).toBe(false);
  }
});

test('requires a non-empty reason and a proceed button', () => {
  expect(shouldAcknowledge({ reason: null, hasProceedButton: true })).toBe(
    false,
  );
  expect(shouldAcknowledge({ reason: '   ', hasProceedButton: true })).toBe(
    false,
  );
  expect(
    shouldAcknowledge({ reason: WARNING_REASON, hasProceedButton: false }),
  ).toBe(false);
  expect(
    shouldAcknowledge({ reason: WARNING_REASON, hasProceedButton: true }),
  ).toBe(true);
});

test('screen key changes with video identity', () => {
  expect(warningScreenKey(WARNING_REASON, 'a')).not.toBe(
    warningScreenKey(WARNING_REASON, 'b'),
  );
});
