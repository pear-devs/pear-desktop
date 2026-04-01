import { createSignal, createEffect, onCleanup, Show } from 'solid-js'; // Adicionado o Show aqui
import { render } from 'solid-js/web';

import style from './style.css?inline';
import { createPlugin } from '@/utils';

export interface SlowedConfig {
  enabled: boolean;
  speed: number;
  keepPitch: boolean;
}

const DEFAULT_CONFIG: SlowedConfig = {
  enabled: false,
  speed: 1.0,
  keepPitch: false,
};

export default createPlugin({
  name: () => 'Slowed',
  restartNeeded: false,
  config: DEFAULT_CONFIG,
  stylesheets: [style],

  renderer: {
    cleanup: null as (() => void) | null,

    start({ config, setConfig }) {
      const safeConfig = config || DEFAULT_CONFIG;
      const [speed, setSpeed] = createSignal(safeConfig.speed ?? 1.0);
      const [keepPitch, setKeepPitch] = createSignal(safeConfig.keepPitch ?? false);
      const [collapsed, setCollapsed] = createSignal(false);

      const getVideo = () => document.querySelector<HTMLVideoElement>('video');

      document.getElementById('sr-panel')?.remove();

      const panel = document.createElement('div');
      panel.id = 'sr-panel';
      document.body.appendChild(panel);

      const dispose = render(() => (
        <div class="sr-container">
          <div class="sr-header" onClick={() => setCollapsed(!collapsed())} style="cursor: pointer;">
            <span class="sr-logo">◈</span>
            <span class="sr-title"> SLOWED</span>
          </div>
          
          {/* MUDANÇA PEDIDA: Uso do <Show> em vez de {&&} */}
          <Show when={!collapsed()}>
            <div class="sr-body">
              <div class="sr-presets">
                <button class="sr-btn" onClick={() => { setSpeed(0.75); setKeepPitch(false); }}>Slowed</button>
                <button class="sr-btn" onClick={() => { setSpeed(1.25); setKeepPitch(true); }}>Nightcore</button>
                <button class="sr-btn sr-btn--danger" onClick={() => { setSpeed(1.0); setKeepPitch(false); }}>Reset</button>
              </div>
              <div class="sr-row">
                <div class="sr-label-row">
                  <span class="sr-label">Speed</span>
                  <span class="sr-val">{speed().toFixed(2)}x</span>
                </div>
                <input 
                  class="sr-slider" 
                  type="range" min="0.5" max="1.5" step="0.01" 
                  value={speed()} 
                  onInput={(e) => setSpeed(parseFloat(e.currentTarget.value))}
                  style={{ '--fill': `${((speed() - 0.5) / (1.5 - 0.5)) * 100}%` }}
                />
              </div>
              <div class="sr-row sr-pitch-row">
                <span class="sr-label">Keep pitch</span>
                <label class="sr-switch">
                  <input type="checkbox" checked={keepPitch()} onChange={(e) => setKeepPitch(e.currentTarget.checked)} />
                  <span class="sr-thumb"></span>
                </label>
              </div>
              <div class="sr-footer">Made by Kryz &lt;3</div>
            </div>
          </Show>
        </div>
      ), panel);

      const interval = setInterval(() => {
        const video = getVideo();
        if (video && Math.abs(video.playbackRate - speed()) > 0.01) {
          video.playbackRate = speed();
          video.preservesPitch = keepPitch();
        }
      }, 500);

      const doCleanup = () => {
        clearInterval(interval);
        dispose();
        panel.remove();
        const video = getVideo();
        if (video) {
          video.playbackRate = 1.0;
          video.preservesPitch = true;
        }
      };

      this.cleanup = doCleanup;
      onCleanup(doCleanup);

      createEffect(() => {
        const video = getVideo();
        if (video) {
          video.playbackRate = speed();
          video.preservesPitch = keepPitch();
        }
      });

      createEffect(() => {
        setConfig({ speed: speed(), keepPitch: keepPitch() });
      });
    },

    stop() {
      if (this.cleanup) {
        this.cleanup();
        this.cleanup = null;
      }
    }
  },
});