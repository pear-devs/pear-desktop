import type { ProviderState } from '../providers';

// Consume internal lifecycle strings here, never format them as visible labels.
export const providerIndicator = (
  state: ProviderState,
  usable: boolean,
): 'searching' | 'success' | 'unavailable' | 'failure' | 'hidden' => {
  if (state.error && 'kind' in state.error && state.error.kind === 'aborted')
    return 'hidden';
  if (state.state === 'fetching') return 'searching';
  if (state.state === 'error') return 'failure';
  return usable ? 'success' : 'unavailable';
};
