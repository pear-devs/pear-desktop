import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { test, expect, _electron as electron } from '@playwright/test';
import { build } from 'vite';
import solid from 'vite-plugin-solid';

const root = path.resolve(import.meta.dirname, '..');
const plugin = path.join(root, 'src/plugins/synced-lyrics');
let bundle;
let css;
let theme;

test.beforeAll(async ({}, testInfo) => {
  const outDir = testInfo.outputPath('fixture');
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { '@': path.join(root, 'src') } },
    plugins: [
      solid(),
      {
        name: 'lyrics-picker-fixture',
        enforce: 'pre',
        resolveId(id, importer) {
          if (
            importer?.endsWith('/renderer/renderer.tsx') &&
            id === './components'
          )
            return path.join(root, 'tests/lyrics-layout-components.tsx');
          if (id === 'fixture' || id === path.join(root, 'fixture'))
            return path.join(root, 'tests/lyrics-picker-fixture.tsx');
          if (importer?.endsWith('/renderer/store.ts') && id === './renderer')
            return '\0fixture-config';
          if (
            importer?.endsWith('/renderer/store.ts') &&
            id === '../providers/renderer'
          )
            return '\0fixture-providers';
          return null;
        },
        load(id) {
          if (id === path.join(root, 'tests/lyrics-layout-components.tsx'))
            return `
            export const LoadingKaomoji=()=> <div>Searching</div>;
            export const NotFoundKaomoji=()=> <div>No lyrics</div>;
            export const ErrorDisplay=()=> <div>Unavailable</div>;
            export const PlainLyrics=(props)=> <div style={{height:'80px'}}>{props.line}</div>;
            export const SyncedLine=(props)=> <div data-index={props.index} data-status={props.status} style={{height:'80px'}}>{props.line.text}</div>;
          `;
          if (id === '\0fixture-config')
            return `import {createSignal} from 'solid-js'; export const [config,setConfig]=createSignal({enabled:true,preferredProvider:'auto',showLyricsEvenIfInexact:false});`;
          if (id === '\0fixture-providers')
            return `export const providers=Object.fromEntries(['YTMusic','LRCLib','MusixMatch','LyricsGenius'].map(name=>[name,{name,baseUrl:'fixture',search:()=>new Promise(()=>{})}]));`;
          if (id !== path.join(root, 'tests/lyrics-picker-fixture.tsx'))
            return null;
          return `
          import 'mdui'; import 'mdui/mdui.css';
          import {render} from 'solid-js/web';
          import {LyricsPicker} from '${plugin}/renderer/components/LyricsPicker.tsx';
          import * as store from '${plugin}/renderer/store.ts';
          import {LyricsRenderer,setIsVisible,setCurrentTime} from '${plugin}/renderer/renderer';
          if(!customElements.get('yt-formatted-string')) customElements.define('yt-formatted-string',class extends HTMLElement {set text(value){this.textContent=value.runs.map(run=>run.text).join('');}});
          let dispose=render(()=><LyricsPicker setStickRef={()=>null}/>,document.getElementById('fixture'));
          window.fixture={
            track(videoId){store.fetchLyrics({videoId,title:'Fixture Song',artist:'Artist',songDuration:200});},
            publish(provider,candidates,state='done'){store.setLyricsStore('lyrics',provider,{state,candidates,error:state==='error'?new Error('Provider unavailable'):null});},
            auto:store.selectAuto,
            layout(){dispose();setIsVisible(true);dispose=render(()=><LyricsRenderer/>,document.getElementById('fixture'));},
            visible:setIsVisible,time:setCurrentTime,
            snapshot(){return {selected:store.selection().selected?.candidate.id??null,provider:store.lyricsStore.provider,manual:store.lyricsStore.manualChoice,songChoice:store.lyricsStore.songChoice,unavailable:store.selection().unavailableChoice,current:{state:store.currentLyrics().state,data:!!store.currentLyrics().data,error:!!store.currentLyrics().error},ranked:store.rankedCandidates().map(item=>item.candidate.id)};},
            dispose(){dispose();store.disposeSearch();}
          };`;
        },
      },
    ],
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: 'fixture',
        formats: ['iife'],
        name: 'lyricsFixture',
        cssFileName: 'fixture',
        fileName: () => 'fixture.js',
      },
    },
  });
  bundle = path.join(outDir, 'fixture.js');
  css = await readFile(path.join(plugin, 'style.css'), 'utf8');
  theme = await readFile(path.join(outDir, 'fixture.css'), 'utf8');
});

const source = (id, level = 'line', provider = 'LRCLib') => ({
  id,
  sourceId: id,
  provider,
  album: 'Fixture Song',
  result: {
    title: 'Fixture Song',
    artists: ['Artist'],
    syncLevel: level,
    ...(level === 'plain'
      ? { lyrics: 'Hello' }
      : {
          lines: [
            {
              text: 'Hello',
              startMs: 0,
              ...(level === 'word'
                ? { segments: [{ text: 'Hello', startMs: 0 }] }
                : {}),
            },
          ],
        }),
  },
});

test('original picker controls with retained multi-candidate logic and progressive identity', async ({}, testInfo) => {
  const app = await electron.launch({
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      XDG_CONFIG_HOME: testInfo.outputPath('config'),
      XDG_CACHE_HOME: testInfo.outputPath('cache'),
    },
    args: [
      root,
      '--no-sandbox',
      '--disable-gpu',
      `--user-data-dir=${testInfo.outputPath('profile')}`,
    ],
  });
  try {
    await app.firstWindow();
    await app.context().route('http://lyrics-picker.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<body style="margin:0;background:black;color:white"><div id="fixture"></div></body>',
      }),
    );
    const opened = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }) => {
      const window = new BrowserWindow({
        width: 360,
        height: 700,
        webPreferences: { contextIsolation: false },
      });
      window.loadURL('http://lyrics-picker.test/');
    });
    const page = await opened;
    await page.waitForSelector('#fixture', { state: 'attached' });
    await page.addStyleTag({ content: css });
    await page.addStyleTag({ content: theme });
    await page.addScriptTag({ path: bundle });
    const snapshot = () => page.evaluate(() => window.fixture.snapshot());
    await page.evaluate(() => window.fixture.track('A'));
    await page.evaluate(
      (candidate) => window.fixture.publish('LRCLib', [candidate]),
      source('fixture-line'),
    );
    expect(await snapshot()).toMatchObject({
      selected: 'fixture-line',
      provider: 'LRCLib',
      manual: null,
    });
    await expect(page.locator('yt-formatted-string')).toHaveText([
      'YTMusic',
      'LRCLib',
      'MusixMatch',
      'LyricsGenius',
    ]);
    await expect(
      page.locator(
        'mdui-select, select, mdui-menu-item, .lyrics-picker mdui-button, .lyrics-picker [role="status"]',
      ),
    ).toHaveCount(0);
    await expect(page.locator('.lyrics-picker-dot')).toHaveCount(4);
    await expect(page.locator('.lyrics-picker mdui-button-icon')).toHaveCount(
      6,
    );
    expect(
      await page
        .locator('[aria-label="Next lyrics provider"]')
        .evaluate((element) => element.disabled),
    ).toBe(true);
    await expect(page.locator('.lyrics-picker-dot-available')).toHaveCount(1);
    await expect(page.locator('.lyrics-picker-dot-current')).toHaveCount(1);
    // Skip unavailable providers and wrap on first click, not several clicks.
    await page.evaluate(
      (candidate) => window.fixture.publish('YTMusic', [candidate]),
      source('yt', 'line', 'YTMusic'),
    );
    await page.locator('[aria-label="Next lyrics provider"]').click();
    expect(await snapshot()).toMatchObject({
      selected: 'yt',
      provider: 'YTMusic',
    });
    await page.locator('[aria-label="Previous lyrics provider"]').click();
    expect(await snapshot()).toMatchObject({
      selected: 'fixture-line',
      provider: 'LRCLib',
    });
    await expect(page.locator('.lyrics-picker-dot-available')).toHaveCount(2);
    await expect(page.locator('.lyrics-picker-dot-current')).toHaveAttribute(
      'aria-label',
      'Choose LRCLib',
    );
    await page.evaluate(() => window.fixture.publish('YTMusic', []));
    // Existing dot pins actual candidate identity, not progressive array position.
    await page.locator('[aria-label="Choose LRCLib"]').press('Enter');
    expect(await snapshot()).toMatchObject({
      manual: { provider: 'LRCLib', candidateId: 'fixture-line' },
    });
    await page.evaluate(
      (candidates) => window.fixture.publish('LRCLib', candidates),
      [
        source('better', 'word'),
        source('fixture-line'),
        source('plain', 'plain'),
      ],
    );
    expect(await snapshot()).toMatchObject({
      selected: 'fixture-line',
      ranked: ['better', 'fixture-line', 'plain'],
    });
    const star = page
      .locator('.lyrics-picker-item')
      .nth(1)
      .locator('mdui-button-icon');
    await star.click();
    await expect(page.locator('[aria-pressed="true"]')).toHaveCount(1);
    expect(await snapshot()).toMatchObject({
      songChoice: { provider: 'LRCLib', candidateId: 'fixture-line' },
    });
    await page.evaluate(
      (candidates) => window.fixture.publish('LRCLib', candidates),
      [
        source('plain', 'plain'),
        source('fixture-line'),
        source('better', 'word'),
      ],
    );
    expect(await snapshot()).toMatchObject({ selected: 'fixture-line' });
    await star.click();
    await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);
    expect(await snapshot()).toMatchObject({
      selected: 'better',
      manual: null,
      songChoice: null,
    });
    // Original arrows traverse providers, not variants. No duplicate controls.
    await page.evaluate(
      (candidate) => window.fixture.publish('MusixMatch', [candidate]),
      source('musix', 'word', 'MusixMatch'),
    );
    await page.locator('[aria-label="Next lyrics provider"]').click();
    expect(await snapshot()).toMatchObject({
      selected: 'musix',
      manual: { provider: 'MusixMatch' },
    });
    await page.locator('[aria-label="Previous lyrics provider"]').click();
    expect(await snapshot()).toMatchObject({
      selected: 'better',
      manual: { provider: 'LRCLib' },
    });
    // Store Auto still exists for future UI, but adds no visible action.
    await page.evaluate(() => window.fixture.auto());
    await page.evaluate(
      (candidate) =>
        window.fixture.publish('MusixMatch', [
          { ...candidate, exactVideoId: 'A' },
        ]),
      source('late', 'word', 'MusixMatch'),
    );
    expect(await snapshot()).toMatchObject({
      selected: 'late',
      provider: 'MusixMatch',
      manual: null,
    });
    await page.evaluate(() => {
      window.fixture.track('B');
      window.fixture.track('C');
    });
    expect(await snapshot()).toMatchObject({
      selected: null,
      provider: 'YTMusic',
      manual: null,
      songChoice: null,
      ranked: [],
    });
    expect(await snapshot()).toMatchObject({
      current: { state: 'fetching', data: false, error: false },
    });
    await expect(page.locator('.lyrics-picker-dot-available')).toHaveCount(0);
    await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);
    await page.evaluate(
      (candidate) => window.fixture.publish('LRCLib', [candidate]),
      source('plain-only', 'plain'),
    );
    await page.locator('[aria-label="Choose LyricsGenius"]').click();
    expect(await snapshot()).toMatchObject({
      selected: 'plain-only',
      unavailable: true,
      manual: { provider: 'LyricsGenius' },
    });
    await page.evaluate(() => {
      for (const provider of [
        'YTMusic',
        'LRCLib',
        'MusixMatch',
        'LyricsGenius',
      ])
        window.fixture.publish(provider, [], 'error');
    });
    expect(await snapshot()).toMatchObject({ selected: null });
    expect(await snapshot()).toMatchObject({
      current: { state: 'error', data: false, error: true },
    });
    await expect(page.locator('[aria-label="Lyrics unavailable"]')).toHaveCount(
      4,
    );
    await page.evaluate(() => {
      window.fixture.auto();
      for (const provider of [
        'YTMusic',
        'LRCLib',
        'MusixMatch',
        'LyricsGenius',
      ])
        window.fixture.publish(provider, []);
    });
    await expect(page.locator('[aria-label="No lyrics found"]')).toHaveCount(4);
    expect(await snapshot()).toMatchObject({
      current: { state: 'done', data: false, error: false },
    });
    expect(
      await page
        .locator('[aria-label="Next lyrics provider"]')
        .evaluate((element) => element.disabled),
    ).toBe(true);
    await expect(page.locator('.lyrics-picker-dot-available')).toHaveCount(0);
    const text = await page.locator('.lyrics-picker').innerText();
    for (const raw of [
      'done',
      'fetching',
      'error',
      'failed',
      'no-match',
      'aborted',
      'timeout',
      'fixture-line',
      'Fixture Song',
      'Auto',
      'Retry',
    ])
      expect(text).not.toContain(raw);
    const geometry = await page
      .locator('.lyrics-picker')
      .evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        scroll: element.scrollWidth,
      }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
    // Real renderer and real virtualizer: header is never a recycled list item.
    await page.evaluate(() => {
      document.getElementById('fixture').style.height = '480px';
      window.fixture.layout();
      window.fixture.track('layout');
      window.fixture.publish('LRCLib', [
        {
          id: 'layout',
          sourceId: 'layout',
          provider: 'LRCLib',
          result: {
            title: 'Fixture Song',
            artists: ['Artist'],
            syncLevel: 'line',
            lines: Array.from({ length: 80 }, (_, index) => ({
              text: `Line ${index}`,
              startMs: index * 1000,
              endMs: (index + 1) * 1000,
            })),
          },
        },
      ]);
    });
    const header = page.locator('.lyrics-picker');
    const headerContainer = page.locator('.lyrics-picker-header');
    await expect(headerContainer).toHaveAttribute('aria-hidden', 'false');
    const headerBox = await header.boundingBox();
    const scroller = page.locator('.synced-lyrics-vlist');
    const scrollerBox = await scroller.boundingBox();
    for (const offset of [1500, 4000, 6000]) {
      await scroller.evaluate((element, top) => {
        element.scrollTop = top;
      }, offset);
      await page.mouse.move(180, 350);
      await expect(headerContainer).toHaveAttribute('aria-hidden', 'true');
      expect(Math.round((await headerContainer.boundingBox()).y)).toBe(
        Math.round(headerBox.y),
      );
      // Hover reveals the whole panel at precisely its original position.
      await page.mouse.move(180, headerBox.y + 10);
      await expect(headerContainer).toHaveAttribute('aria-hidden', 'false');
      await expect
        .poll(async () => Math.round((await header.boundingBox()).y))
        .toBe(Math.round(headerBox.y));
      expect(Math.round((await header.boundingBox()).height)).toBe(
        Math.round(headerBox.height),
      );
      expect(await scroller.boundingBox()).toEqual(scrollerBox);
    }
    await page.evaluate(() => window.fixture.time(30000));
    await expect(page.locator('[data-index="31"]')).toHaveAttribute(
      'data-status',
      'current',
    );
    await expect
      .poll(async () => Math.round((await header.boundingBox()).y))
      .toBe(Math.round(headerBox.y));
    await page.evaluate(() => {
      window.fixture.visible(false);
    });
    await expect(header).toHaveCount(0);
    await page.evaluate(() => {
      window.fixture.visible(true);
      document.getElementById('fixture').style.height = '320px';
    });
    await expect(header).toBeVisible();
    await page.mouse.move(180, 10);
    await expect(headerContainer).toHaveAttribute('aria-hidden', 'false');
    await expect
      .poll(async () => Math.round((await header.boundingBox()).y))
      .toBe(Math.round(headerBox.y));
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.mouse.move(180, 250);
    await expect(headerContainer).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('.lyrics-picker-dot-available')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );
    await page.evaluate(() => window.fixture.dispose());
  } finally {
    await app.close();
  }
});
