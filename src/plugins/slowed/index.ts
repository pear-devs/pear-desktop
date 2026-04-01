import style from './style.css?inline';
import { createPlugin } from '@/utils';

// ─── Config ────────────────────────────────────────────────────────────────

export interface SlowedReverbConfig {
  enabled: boolean;
  speed: number;        
  reverbAmount: number; 
  bassBoost: number;    
  keepPitch: boolean;
}

const DEFAULT_CONFIG: SlowedReverbConfig = {
  enabled: false,
  speed: 1.0,
  reverbAmount: 0,
  bassBoost: 0,
  keepPitch: false,
};

// Variável global inviolável para guardar a config atual
let currentConfig = { ...DEFAULT_CONFIG };

// ─── Audio Engine ──────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let convolverNode: ConvolverNode | null = null;
let bassFilter: BiquadFilterNode | null = null;
let dryGain: GainNode | null = null;
let wetGain: GainNode | null = null;
let masterGain: GainNode | null = null;
let engineReady = false;
let connectedVideo: HTMLVideoElement | null = null;

function makeImpulse(ctx: AudioContext, duration = 3, decay = 2): AudioBuffer {
  const len = ctx.sampleRate * duration;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function buildEngine(video: HTMLVideoElement) {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass();
    
    bassFilter = audioCtx.createBiquadFilter();
    convolverNode = audioCtx.createConvolver();
    dryGain = audioCtx.createGain();
    wetGain = audioCtx.createGain();
    masterGain = audioCtx.createGain();

    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 150; 
    bassFilter.gain.value = 0;

    convolverNode.buffer = makeImpulse(audioCtx);

    bassFilter.connect(dryGain);
    bassFilter.connect(convolverNode);
    convolverNode.connect(wetGain);
    dryGain.connect(masterGain);
    wetGain.connect(masterGain);
    masterGain.connect(audioCtx.destination);
  }

  // Garante que o áudio seja reconectado se o YT Music recriar o vídeo
  if (connectedVideo !== video) {
    if (sourceNode) {
      sourceNode.disconnect();
    }
    try {
      sourceNode = audioCtx.createMediaElementSource(video);
      sourceNode.connect(bassFilter);
      connectedVideo = video;
      engineReady = true;
    } catch (e) {
      console.warn('[Slowed&Reverb] Aviso ao conectar nó de áudio:', e);
    }
  }
}

function applyConfig(cfg: SlowedReverbConfig, video: HTMLVideoElement | null) {
  if (!video) return;

  currentConfig = cfg;

  video.playbackRate = cfg.speed;
  video.preservesPitch = cfg.keepPitch;

  buildEngine(video);
  if (!audioCtx || !dryGain || !wetGain || !bassFilter) return;

  const t0 = audioCtx.currentTime;
  
  const wet = cfg.reverbAmount / 100;
  dryGain.gain.setTargetAtTime(1 - wet * 0.7, t0, 0.05);
  wetGain.gain.setTargetAtTime(wet * 2.5, t0, 0.05); 

  bassFilter.gain.setTargetAtTime((cfg.bassBoost / 100) * 20, t0, 0.05);

  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

function disableEngine(video: HTMLVideoElement | null) {
  if (video) {
    video.playbackRate = 1.0;
    video.preservesPitch = true;
  }
  if (!audioCtx || !dryGain || !wetGain || !bassFilter) return;

  const t0 = audioCtx.currentTime;
  dryGain.gain.setTargetAtTime(1, t0, 0.05);
  wetGain.gain.setTargetAtTime(0, t0, 0.05);
  bassFilter.gain.setTargetAtTime(0, t0, 0.05);
}

function getVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('video');
}

// ─── UI Panel Builder (Intacto, 100% o seu design) ─────────────────────────

const PRESETS: Record<string, Partial<SlowedReverbConfig>> = {
  slowed:          { speed: 0.75, reverbAmount: 0,  bassBoost: 0  },
  reverb:          { speed: 1.0,  reverbAmount: 60, bassBoost: 0  },
  'slowed+reverb': { speed: 0.8,  reverbAmount: 40, bassBoost: 10 },
  nightcore:       { speed: 1.25, reverbAmount: 0,  bassBoost: 0  },
  reset:           { speed: 1.0,  reverbAmount: 0,  bassBoost: 0, keepPitch: false },
};

function buildPanel(
  cfg: SlowedReverbConfig,
  persist: (patch: Partial<SlowedReverbConfig>) => void,
): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'sr-panel';
  panel.innerHTML = `
    <div class="sr-header">
      <span class="sr-logo">◈</span>
      <span class="sr-title">Slowed &amp; Reverb</span>
      <button class="sr-collapse" id="sr-collapse" title="Minimizar">⌃</button>
    </div>
    <div class="sr-body" id="sr-body">
      <div class="sr-presets">
        <button class="sr-btn" data-preset="slowed">Slowed</button>
        <button class="sr-btn" data-preset="reverb">Reverb</button>
        <button class="sr-btn" data-preset="slowed+reverb">S+R</button>
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
      <div class="sr-row">
        <div class="sr-label-row">
          <span class="sr-label">Reverb</span>
          <span class="sr-val" id="sr-reverb-val">${cfg.reverbAmount}%</span>
        </div>
        <input class="sr-slider" id="sr-reverb" type="range" min="0" max="100" step="1" value="${cfg.reverbAmount}" />
      </div>
      <div class="sr-row">
        <div class="sr-label-row">
          <span class="sr-label">Bass Boost</span>
          <span class="sr-val" id="sr-bass-val">${cfg.bassBoost}%</span>
        </div>
        <input class="sr-slider" id="sr-bass" type="range" min="0" max="100" step="1" value="${cfg.bassBoost}" />
      </div>
      <div class="sr-row sr-pitch-row">
        <span class="sr-label">Keep pitch</span>
        <label class="sr-switch">
          <input type="checkbox" id="sr-pitch" ${cfg.keepPitch ? 'checked' : ''} />
          <span class="sr-thumb"></span>
        </label>
      </div>
    </div>
  `;

  const $ = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
  const speed = $<HTMLInputElement>('#sr-speed');
  const reverb = $<HTMLInputElement>('#sr-reverb');
  const bass = $<HTMLInputElement>('#sr-bass');
  const pitch = $<HTMLInputElement>('#sr-pitch');
  const body = $<HTMLDivElement>('#sr-body');

  function updateSliderFill(input: HTMLInputElement) {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const val = parseFloat(input.value);
    const pct = ((val - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  }

  function syncSlider(input: HTMLInputElement, valEl: HTMLElement, format: (n: number) => string, key: keyof SlowedReverbConfig, parse: (s: string) => number) {
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
  syncSlider(reverb, $('#sr-reverb-val'), (v) => v + '%', 'reverbAmount', parseInt);
  syncSlider(bass, $('#sr-bass-val'), (v) => v + '%', 'bassBoost', parseInt);

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
      if (patch.speed !== undefined) { speed.value = String(patch.speed); $('#sr-speed-val').textContent = patch.speed.toFixed(2) + 'x'; updateSliderFill(speed); }
      if (patch.reverbAmount !== undefined) { reverb.value = String(patch.reverbAmount); $('#sr-reverb-val').textContent = patch.reverbAmount + '%'; updateSliderFill(reverb); }
      if (patch.bassBoost !== undefined) { bass.value = String(patch.bassBoost); $('#sr-bass-val').textContent = patch.bassBoost + '%'; updateSliderFill(bass); }
      if (patch.keepPitch !== undefined) { pitch.checked = patch.keepPitch; }
      applyConfig(cfg, getVideo());
    });
  });

  let collapsed = false;
  $('#sr-collapse').addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : '';
    $('#sr-collapse').textContent = collapsed ? '⌄' : '⌃';
  });

  return panel;
}

// ─── Plugin Definition ─────────────────────────────────────────────────────

let watchInterval: any = null;
let lastVideoSrc = "";

export default createPlugin({
  name: () => 'Slowed & Reverb', 
  restartNeeded: false,
  config: DEFAULT_CONFIG as any,

  menu: async () => { return []; },

  renderer: {
    start({ config, setConfig }) {
      const styleSheet = document.createElement('style');
      styleSheet.textContent = style;
      document.head.appendChild(styleSheet);

      currentConfig = { ...DEFAULT_CONFIG, ...(config as any) };

      // O Vigia Implacável: Roda a cada 300ms e garante que o YT Music não desfaça nada
      watchInterval = setInterval(() => {
        const video = getVideo();
        if (!video) return;

        // Injeta o painel se ele sumir por conta do YT recarregar a página
        if (!document.getElementById('sr-panel')) {
          const panel = buildPanel(currentConfig, (patch) => setConfig(patch as any));
          document.body.appendChild(panel);
        }

        // Se a música trocar (o endereço do vídeo mudou)
        if (video.src !== lastVideoSrc) {
          lastVideoSrc = video.src;
          applyConfig(currentConfig, video); // Reaplica os filtros
        }

        // O BLOQUEIO DE VELOCIDADE: Se o YT Music tentar resetar pra 1.0, forçamos a config atual
        if (video.playbackRate !== currentConfig.speed) {
          video.playbackRate = currentConfig.speed;
        }

        if (video.preservesPitch !== currentConfig.keepPitch) {
          video.preservesPitch = currentConfig.keepPitch;
        }
      }, 300);
    },
    
    onConfigChange(newConfig) {
      currentConfig = newConfig as SlowedReverbConfig;
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
      setVal('#sr-reverb', String((newConfig as any).reverbAmount));
      setVal('#sr-bass', String((newConfig as any).bassBoost));
      
      const pitch = panel.querySelector<HTMLInputElement>('#sr-pitch');
      if (pitch) pitch.checked = (newConfig as any).keepPitch;

      const sv = panel.querySelector('#sr-speed-val');
      const rv = panel.querySelector('#sr-reverb-val');
      const bv = panel.querySelector('#sr-bass-val');
      if (sv) sv.textContent = (newConfig as any).speed.toFixed(2) + 'x';
      if (rv) rv.textContent = (newConfig as any).reverbAmount + '%';
      if (bv) bv.textContent = (newConfig as any).bassBoost + '%';
    },

    stop() {
      if (watchInterval) clearInterval(watchInterval);
      disableEngine(getVideo());
      document.getElementById('sr-panel')?.remove();
    }
  }
});