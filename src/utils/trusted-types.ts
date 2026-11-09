import type { TrustedTypePolicy } from 'trusted-types/lib';

export let defaultTrustedTypePolicy: Pick<
  TrustedTypePolicy<{
    createHTML: (input: string) => string;
    createScriptURL: (input: string) => string;
    createScript: (input: string) => string;
  }>,
  'name' | 'createHTML' | 'createScript' | 'createScriptURL'
>;

export const registerWindowDefaultTrustedTypePolicy = () => {
  if (!window.trustedTypes?.createPolicy) return;
  const rules = {
    createHTML: (input: string) => input,
    createScriptURL: (input: string) => input,
    createScript: (input: string) => input,
  };
  // The page (or another script) may already own the "default" policy, and
  // createPolicy throws on a duplicate name, which would stop the whole
  // renderer, so fall back to a policy of our own.
  try {
    defaultTrustedTypePolicy = window.trustedTypes.createPolicy(
      'default',
      rules,
    );
  } catch {
    try {
      defaultTrustedTypePolicy = window.trustedTypes.createPolicy(
        'pear-desktop',
        rules,
      );
    } catch (error) {
      console.warn('[YTMusic] Could not create a Trusted Types policy', error);
    }
  }
};
