import { registerHooks } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

import { test, expect } from '@playwright/test';

/**
 * The panel's renderer entry pulls in a CSS `?inline` import and the i18n
 * barrel (which pulls `virtual:i18n`); stub both at the loader boundary so the
 * real panel can run headless over a happy-dom document.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'virtual:i18n') {
      return {
        url: 'data:text/javascript,export const languageResources = async () => ({});',
        shortCircuit: true,
      };
    }
    if (specifier.endsWith('?inline')) {
      return {
        url: 'data:text/javascript,export default "";',
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

async function boot() {
  const { Window } = await import('happy-dom');
  const win = new Window();

  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = win;
  globals.document = win.document;
  globals.CustomEvent = win.CustomEvent;
  globals.Event = win.Event;
  globals.MutationObserver = win.MutationObserver;
  globals.Node = win.Node;
  globals.Element = win.Element;
  globals.HTMLElement = win.HTMLElement;
  globals.HTMLButtonElement = win.HTMLButtonElement;

  const layout = win.document.createElement('ytmusic-app-layout');
  const bar = win.document.createElement('ytmusic-player-bar');
  layout.append(bar);
  win.document.body.append(layout);

  const playerPanel = await import('./player-panel');
  return { document: win.document, layout, bar, playerPanel };
}

test('the cog reattaches when YouTube Music replaces the player bar', async () => {
  const { document, layout, bar, playerPanel } = await boot();

  playerPanel.registerPlayerPanelSection({
    id: 'test-section',
    title: 'Test',
    root: document.createElement('div') as unknown as HTMLElement,
  });
  expect(bar.querySelector('.pbg-cog')).not.toBeNull();

  // Let the observer callback queued by the cog insertion settle, so the swap
  // below is the only change the observer can react to.
  await delay(0);

  // A wholesale bar swap is a childList mutation of the PARENT, not of the bar:
  // an observer bound to the bar never fires, so the cog would stay detached.
  const replacement = document.createElement('ytmusic-player-bar');
  bar.remove();
  layout.append(replacement);
  await delay(0);

  expect(bar.isConnected).toBe(false);
  expect(replacement.querySelector('.pbg-cog')).not.toBeNull();

  playerPanel.unregisterPlayerPanelSection('test-section');
});

test('the cog attaches from the bar fallback before the volume anchor renders', async () => {
  const { document, bar, playerPanel } = await boot();

  // The bar element can mount before its internals upgrade: no #volume-slider,
  // no .volume-container. findCogAnchor falls back to the bar itself, so the cog
  // must be placed now - not stranded waiting for a mutation the parent-childList
  // observer will never see (that mutation happens inside the bar).
  playerPanel.registerPlayerPanelSection({
    id: 'test-fallback',
    title: 'Test',
    root: document.createElement('div') as unknown as HTMLElement,
  });
  const cog = bar.querySelector('.pbg-cog');
  expect(cog).not.toBeNull();

  // The volume controls render later, inside the bar. Invisible to the parent
  // observer; the cog must therefore already be attached - and stays attached.
  const slider = document.createElement('div');
  slider.id = 'volume-slider';
  bar.append(slider);
  await delay(0);
  expect(cog?.isConnected).toBe(true);

  playerPanel.unregisterPlayerPanelSection('test-fallback');
});
