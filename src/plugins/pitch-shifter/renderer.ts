import sliderHTML from './templates/slider.html?raw';

import { getSongMenu } from '@/providers/dom-elements';
import { singleton } from '@/providers/decorators';

import { defaultTrustedTypePolicy } from '@/utils/trusted-types';

import workerScript from './soundtouch-worklet.js?raw';

import { ElementFromHtml } from '../utils/renderer';

const slider = ElementFromHtml(sliderHTML);

const roundToTwo = (n: number) => Math.round(n * 1e2) / 1e2;

const MIN_PITCH_SHIFT = -12;
const MAX_PITCH_SHIFT = 12;

let pitchShift = 0;

let storedAudioSource: AudioNode;
let storedAudioContext: AudioContext;
let pitchShifter: AudioWorkletNode;

const updatePitchShift = () => {
  const ONE_SEMITONE_LINEAR = Math.pow(2, 1 / 12);
  const linearPitch = Math.pow(ONE_SEMITONE_LINEAR, pitchShift);

  pitchShifter.parameters.get('pitch').value = linearPitch;

  const pitchShiftElement = document.querySelector('#pitch-shift-value');
  if (pitchShiftElement) {
    const targetHtml = String(pitchShift);
    (pitchShiftElement.innerHTML as string | TrustedHTML) =
      defaultTrustedTypePolicy
        ? defaultTrustedTypePolicy.createHTML(targetHtml)
        : targetHtml;
  }
};

let menu: Element | null = null;

const immediateValueChangedListener = (e: Event) => {
  pitchShift = (e as CustomEvent<{ value: number }>).detail.value;
  if (isNaN(pitchShift)) {
    pitchShift = 0;
  }

  updatePitchShift();
};

const setupSliderListener = singleton(() => {
  document
    .querySelector('#pitch-shift-slider')
    ?.addEventListener(
      'immediate-value-changed',
      immediateValueChangedListener,
    );
});

const observePopupContainer = () => {
  const observer = new MutationObserver(() => {
    if (!menu) {
      menu = getSongMenu();
    }

    if (menu && !menu.contains(slider)) {
      menu.prepend(slider);
      setupSliderListener();
    }
  });

  const popupContainer = document.querySelector('ytmusic-popup-container');
  if (popupContainer) {
    observer.observe(popupContainer, {
      childList: true,
      subtree: true,
    });
  }
};

const wheelEventListener = (e: WheelEvent) => {
  e.preventDefault();
  if (isNaN(pitchShift)) {
    pitchShift = 0;
  }

  // E.deltaY < 0 means wheel-up
  pitchShift = roundToTwo(
    e.deltaY < 0
      ? Math.min(pitchShift + 0.01, MAX_PITCH_SHIFT)
      : Math.max(pitchShift - 0.01, MIN_PITCH_SHIFT),
  );

  updatePitchShift();
  // Update slider position
  const pitchShiftSlider = document.querySelector<
    HTMLElement & { value: number }
  >('#pitch-shift-slider');
  if (pitchShiftSlider) {
    pitchShiftSlider.value = pitchShift;
  }
};

const setupWheelListener = () => {
  slider.addEventListener('wheel', wheelEventListener);
};

const removePitchShifter = () => {
  if (pitchShifter) {
    pitchShifter.disconnect();
    storedAudioSource.disconnect();
    storedAudioSource.connect(storedAudioContext.destination);
  }
};

const addPitchShifter = async () => {
  //Read audioWorker script as URI
  const blob = new Blob([workerScript], { type: 'application/javascript' });
  const reader = new FileReader();
  reader.readAsDataURL(blob);
  const dataURI = await new Promise((res) => {
    reader.onloadend = function () {
      res(reader.result);
    };
  });
  if (typeof dataURI !== 'string') return;

  await storedAudioContext.audioWorklet.addModule(dataURI);
  pitchShifter = new AudioWorkletNode(
    storedAudioContext,
    'soundtouch-processor',
  );

  storedAudioSource.disconnect();
  storedAudioSource.connect(pitchShifter);
  pitchShifter.connect(storedAudioContext.destination);
};

export const onPlayerApiReady = () => {
  observePopupContainer();
  setupWheelListener();

  if (!storedAudioSource || !storedAudioContext) {
    document.addEventListener(
      'ytmd:audio-can-play',
      ({ detail: { audioSource, audioContext } }) => {
        // Store audioSource and audioContext
        storedAudioSource = audioSource;
        storedAudioContext = audioContext;

        addPitchShifter();
      },
      { once: true, passive: true },
    );
  } else {
    addPitchShifter();
  }
};

export const onUnload = () => {
  slider.removeEventListener('wheel', wheelEventListener);
  getSongMenu()?.removeChild(slider);
  document
    .querySelector('#pitch-shift-slider')
    ?.removeEventListener(
      'immediate-value-changed',
      immediateValueChangedListener,
    );
  removePitchShifter();
};
