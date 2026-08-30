// index.ts
//
// Plugin entry point. Kept as a thin `createPlugin({...})` shell on
// purpose: pear-desktop's build tooling (vite-plugins/plugin-loader.mts)
// statically parses this file's AST looking for a top-level
// `export default {...}` or `export default createPlugin({...})` object
// literal. From that literal it auto-derives a second export,
// `pluginStub`, by stripping the backend/preload/renderer keys — so this
// file must be a literal object passed directly to createPlugin, not a
// class or a variable built up elsewhere and re-exported.
//
// The actual virtualized-scrolling implementation lives in renderer.ts
// and selectors.ts; this file only wires pear-desktop's renderer
// lifecycle hooks (onPlayerApiReady / stop) to it.

import { createPlugin } from '@/utils';

import { onPlayerApiReady, stop } from './renderer';

export default createPlugin({
  name: () => 'Recycled List',
  description: () =>
    'Virtualizes long playlist rows using a recycled element pool, ' +
    'like Android RecyclerView, to fix scroll lag on long playlists.',
  restartNeeded: false,
  config: {
    enabled: false,
  },
  renderer: {
    onPlayerApiReady,
    stop,
  },
});