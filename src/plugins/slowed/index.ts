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

let currentConfig = { ...DEFAULT_CONFIG };

function applyConfig(cfg: SlowedConfig, video: HTMLVideoElement | null) {
  if (!video) return;
  currentConfig = cfg;
  video.playbackRate = cfg.speed;
  video.preservesPitch = cfg.keepPitch;
}

function getVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('video');
}

const PRESETS: Record<string, Partial<SlowedConfig>> = {
  slowed:    { speed: 0.75, keepPitch: false },
  nightcore: { speed: 1.25, keepPitch: true },
  reset:     { speed: 1.0,  keepPitch: false },
};

function buildPanel(
  cfg: SlowedConfig,
  persist: (patch: Partial<SlowedConfig>) => void,
): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'sr-panel';
  panel.innerHTML = `
    <div class="sr-header" title="Clique para ocultar/mostrar">
      <span class="sr-logo">◈</span>
      <span class="sr-title">SLOWED</span>
    </div>
    <div class="sr-body" id="sr-body">
      <div class="sr-presets">
        <button class="sr-btn" data-preset="slowed">Slowed</button>
        <button class="sr-btn" data-preset="nightcore">Nightcore</button>
        <button class="sr-btn sr-btn--danger" data-preset="reset">Reset</button>
      </div>
      <div class="sr-row">
        <div class="sr-label-row">
          <span class="sr-label">Speed</span>
          <span class="sr-val" id="sr-speed-val">${cfg.speed.toFixed(2)}x</span>
        </div>
        <input class="sr-slider" id="sr-speed" type="range" min="0.5" max="1.5" step="0.01" value="${cfg.speed}" />
      </div>
      <div class="sr-row sr-pitch-row">
        <span class="sr-label">Keep pitch</span>
        <label class="sr-switch">
          <input type="checkbox" id="sr-pitch" ${cfg.keepPitch ? 'checked' : ''} />
          <span class="sr-thumb"></span>
        </label>
      </div>
      <div class="sr-footer">Made by Kryz &lt;3</div>
    </div>
  `;

  const $ = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
  const speed = $<HTMLInputElement>('#sr-speed');
  const pitch = $<HTMLInputElement>('#sr-pitch');
  const body = $<HTMLDivElement>('#sr-body');
  const header = $<HTMLDivElement>('.sr-header');

  function updateSliderFill(input: HTMLInputElement) {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const val = parseFloat(input.value);
    const pct = ((val - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  }

  function syncSlider(input: HTMLInputElement, valEl: HTMLElement, format: (n: number) => string, key: keyof SlowedConfig, parse: (s: string) => number) {
    input.addEventListener('input', () => {
      const v = parse(input.value);
      valEl.textContent = format(v);
      (cfg as any)[key] = v;
      currentConfig = cfg; 
      persist({ [key]: v } as any); 
      applyConfig(cfg, getVideo()); 
      updateSliderFill(input);
    });
    updateSliderFill(input);
  }

  syncSlider(speed, $('#sr-speed-val'), (v) => v.toFixed(2) + 'x', 'speed', parseFloat);

  pitch.addEventListener('change', () => {
    cfg.keepPitch = pitch.checked;
    currentConfig = cfg;
    persist({ keepPitch: pitch.checked });
    applyConfig(cfg, getVideo());
  });

  panel.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const patch = PRESETS[btn.dataset.preset!];
      if (!patch) return;
      Object.assign(cfg, patch);
      currentConfig = cfg;
      persist(patch);
      if (patch.speed !== undefined) { 
        speed.value = String(patch.speed); 
        $('#sr-speed-val').textContent = patch.speed.toFixed(2) + 'x'; 
        updateSliderFill(speed); 
      }
      if (patch.keepPitch !== undefined) { 
        pitch.checked = patch.keepPitch; 
      }
      applyConfig(cfg, getVideo());
    });
  });

  let collapsed = false;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : '';
  });

  return panel;
}

let watchInterval: any = null;

export default createPlugin({
  name: () => 'SLOWED', 
  restartNeeded: false,
  config: DEFAULT_CONFIG as any,
  menu: async () => { return []; },
  renderer: {
    start({ config, setConfig }) {
      const styleSheet = document.createElement('style');
      styleSheet.textContent = style;
      document.head.appendChild(styleSheet);
      currentConfig = { ...DEFAULT_CONFIG, ...(config as any) };
      watchInterval = setInterval(() => {
        const video = getVideo();
        if (!video) return;
        if (!document.getElementById('sr-panel')) {
          const panel = buildPanel(currentConfig, (patch) => setConfig(patch as any));
          document.body.appendChild(panel);
        }
        if (video.playbackRate !== currentConfig.speed) {
          video.playbackRate = currentConfig.speed;
        }
        if (video.preservesPitch !== currentConfig.keepPitch) {
          video.preservesPitch = currentConfig.keepPitch;
        }
      }, 300);
    },
    onConfigChange(newConfig) {
      currentConfig = newConfig as SlowedConfig;
      applyConfig(currentConfig, getVideo());
      const panel = document.getElementById('sr-panel');
      if (!panel) return;
      const setVal = (id: string, val: string) => {
        const el = panel.querySelector<HTMLInputElement>(id);
        if (el) {
          el.value = val;
          el.style.setProperty('--fill', `${((parseFloat(val) - parseFloat(el.min)) / (parseFloat(el.max) - parseFloat(el.min))) * 100}%`);
        }
      };
      setVal('#sr-speed', String((newConfig as any).speed));
      const pitch = panel.querySelector<HTMLInputElement>('#sr-pitch');
      if (pitch) pitch.checked = (newConfig as any).keepPitch;
      const sv = panel.querySelector('#sr-speed-val');
      if (sv) sv.textContent = (newConfig as any).speed.toFixed(2) + 'x';
    },
    stop() {
      if (watchInterval) clearInterval(watchInterval);
      const video = getVideo();
      if (video) {
        video.playbackRate = 1.0;
        video.preservesPitch = true;
      }
      document.getElementById('sr-panel')?.remove();
    }
  }
});