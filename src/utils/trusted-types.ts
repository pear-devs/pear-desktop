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
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    try {
      defaultTrustedTypePolicy = window.trustedTypes.createPolicy('default', {
        createHTML: (input) => input,
        createScriptURL: (input) => input,
        createScript: (input) => input,
      });
    } catch {
      // A default policy may already exist; renderer handles a missing policy.
    }
  }
};
