import {
  FilesetResolver,
  LanguageDetector,
} from '@mediapipe/tasks-text';
import lazyVar from 'lazy-var';

import modelAssetPath from './language_detector.tflite?url';

const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@0.10.35/wasm/';

const languageDetector = lazyVar.lazy(async () => {
  const wasmFileset = await FilesetResolver.forTextTasks(WASM_BASE);
  return LanguageDetector.createFromOptions(wasmFileset, {
    baseOptions: {
      modelAssetPath,
    },
    maxResults: 1,
  });
});

export async function detectLanguage(
  text: string,
): Promise<string | undefined> {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  try {
    const detector = await languageDetector.get();
    const result = detector.detect(trimmed);
    const top = result.languages[0];
    if (!top) return undefined;

    return top.languageCode.split('-')[0];
  } catch {
    return undefined;
  }
}
