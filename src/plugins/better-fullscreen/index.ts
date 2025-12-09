import { createPlugin } from '@/utils';
// @ts-ignore
import style from './style.css?inline';
import { getLyrics, LyricResult } from './lyrics';

export default createPlugin({
  name: 'Better Fullscreen',
  restartNeeded: true,
  config: {
    enabled: true,
    perfectSync: false,
    romanize: false
  },
  stylesheets: [style],

  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    return [
      {
        label: 'Enable Better Fullscreen',
        type: 'checkbox',
        checked: config.enabled,
        click: () => setConfig({ ...config, enabled: !config.enabled }),
      }
    ];
  },

  renderer: {
    async start(ctx: any) {
      let config = await ctx.getConfig(); 
      let isFullscreen = false;
      let lyrics: LyricResult | null = null;
      let lastSrc = ''; 
      let retryCount = 0;
      
      const html = `
        <div id="bfs-container">
          <div class="bfs-bg-layer">
            <div class="bfs-blob bfs-blob-1"></div>
            <div class="bfs-blob bfs-blob-2"></div>
            <div class="bfs-blob bfs-blob-3"></div>
            <div class="bfs-blob bfs-blob-4"></div>
            <div class="bfs-blob bfs-blob-5"></div>
          </div>
          <div class="bfs-overlay"></div>
          
          <div class="bfs-corner-zone bfs-zone-left"></div>
          <div class="bfs-corner-zone bfs-zone-right"></div>

          <button id="bfs-settings-btn" title="Settings">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>

          <button id="bfs-close" title="Exit">
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>

          <div id="bfs-settings-modal">
             <div class="bfs-setting-item">
               <span>Perfect Sync</span>
               <label class="bfs-toggle">
                 <input type="checkbox" id="bfs-opt-sync" ${config.perfectSync ? 'checked' : ''}>
                 <span class="bfs-slider"></span>
               </label>
             </div>
             <div class="bfs-setting-item">
               <span>Romanize (Google)</span>
               <label class="bfs-toggle">
                 <input type="checkbox" id="bfs-opt-roman" ${config.romanize ? 'checked' : ''}>
                 <span class="bfs-slider"></span>
               </label>
             </div>
          </div>

          <div class="bfs-content">
            <div class="bfs-lyrics-section">
              <div class="bfs-visualizer-icon" id="bfs-viz">
                <div class="bfs-viz-bar"></div><div class="bfs-viz-bar"></div><div class="bfs-viz-bar"></div>
              </div>
              <div class="bfs-lyrics-scroll" id="bfs-scroll">
                <div class="bfs-lyrics-wrapper" id="bfs-lines">
                   <div class="bfs-empty">Loading...</div>
                </div>
              </div>
            </div>

            <div class="bfs-meta-section">
              <div class="bfs-art"><img id="bfs-art" src="" crossorigin="anonymous" /></div>
              <div class="bfs-info">
                <div class="bfs-title" id="bfs-title">Title</div>
                <div class="bfs-artist" id="bfs-artist">Artist</div>
              </div>
              <div class="bfs-controls-container">
                <div class="bfs-progress-row">
                  <span id="bfs-curr">0:00</span>
                  <div class="bfs-bar-bg" id="bfs-seek"><div class="bfs-bar-fill" id="bfs-fill"></div></div>
                  <span id="bfs-dur">0:00</span>
                </div>
                <div class="bfs-buttons">
                  <button class="bfs-btn bfs-skip-btn" id="bfs-prev"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
                  <button class="bfs-btn bfs-play-btn" id="bfs-play">
                     <svg id="bfs-icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                     <svg id="bfs-icon-pause" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  </button>
                  <button class="bfs-btn bfs-skip-btn" id="bfs-next"><svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>
                </div>
              </div>
            </div>
          </div>
          <canvas id="bfs-canvas" width="50" height="50"></canvas>
        </div>
      `;

      const div = document.createElement('div');
      div.innerHTML = html;
      document.body.appendChild(div);

      const ui = {
        container: document.getElementById('bfs-container'),
        bgLayer: document.querySelector('.bfs-bg-layer') as HTMLElement,
        art: document.getElementById('bfs-art') as HTMLImageElement,
        title: document.getElementById('bfs-title'),
        artist: document.getElementById('bfs-artist'),
        curr: document.getElementById('bfs-curr'),
        dur: document.getElementById('bfs-dur'),
        fill: document.getElementById('bfs-fill'),
        seek: document.getElementById('bfs-seek'),
        lines: document.getElementById('bfs-lines'),
        scroll: document.getElementById('bfs-scroll'),
        canvas: document.getElementById('bfs-canvas') as HTMLCanvasElement,
        viz: document.getElementById('bfs-viz'),
        playBtn: document.getElementById('bfs-play'),
        prevBtn: document.getElementById('bfs-prev'),
        nextBtn: document.getElementById('bfs-next'),
        iconPlay: document.getElementById('bfs-icon-play'),
        iconPause: document.getElementById('bfs-icon-pause'),
        settingsBtn: document.getElementById('bfs-settings-btn'),
        settingsModal: document.getElementById('bfs-settings-modal'),
        optSync: document.getElementById('bfs-opt-sync') as HTMLInputElement,
        optRoman: document.getElementById('bfs-opt-roman') as HTMLInputElement
      };

      const updateColors = () => {
        try {
          const ctx = ui.canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(ui.art, 0, 0, 50, 50);
          const data = ctx.getImageData(0, 0, 50, 50).data;
          
          const getC = (x:number, y:number) => {
             const i = (y * 50 + x) * 4;
             return `rgb(${data[i]}, ${data[i+1]}, ${data[i+2]})`;
          };
          
          document.documentElement.style.setProperty('--bfs-c1', getC(25, 25));
          document.documentElement.style.setProperty('--bfs-c2', getC(10, 10));
          document.documentElement.style.setProperty('--bfs-c3', getC(40, 40));
          document.documentElement.style.setProperty('--bfs-c4', getC(40, 10));
          document.documentElement.style.setProperty('--bfs-c5', getC(10, 40));
        } catch(e) {}
      };

      const renderLyrics = () => {
        if (!ui.lines) return;
        ui.lines.innerHTML = '';
        
        if (!lyrics) {
          ui.lines.innerHTML = `
            <div class="bfs-empty">
              <span>Lyrics not available</span>
              <button class="bfs-refresh-btn" id="bfs-force-fetch" style="margin-top:15px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Retry Search
              </button>
            </div>
          `;
          document.getElementById('bfs-force-fetch')?.addEventListener('click', () => {
             const title = ui.title?.innerText;
             const artist = ui.artist?.innerText;
             const video = document.querySelector('video');
             if(title && artist && video) {
               ui.lines!.innerHTML = '<div class="bfs-empty">Searching...</div>';
               performFetch(title, artist, video.duration);
             }
          });
          return;
        }

        if (lyrics.lines) {
          lyrics.lines.forEach((line) => {
            const el = document.createElement('div');
            el.className = 'bfs-line';
            
            const isInst = line.text.includes('...') || line.text.includes('♪') || line.text.toLowerCase().includes('instrumental');
            
            if(isInst) {
                el.classList.add('instrumental');
                el.innerHTML = `
                  <div class="bfs-viz-icon">
                    <div class="bfs-viz-bar" style="height:12px;"></div>
                    <div class="bfs-viz-bar" style="height:30px; animation-delay:0.2s;"></div>
                    <div class="bfs-viz-bar" style="height:18px; animation-delay:0.4s;"></div>
                  </div>`; 
            } else {
                let html = `<span>${line.text}</span>`;
                if(line.romaji) {
                    html += `<span class="bfs-romaji">${line.romaji}</span>`;
                }
                el.innerHTML = html;
            }
            
            el.onclick = () => {
              const video = document.querySelector('video');
              if (video) video.currentTime = line.timeMs / 1000;
            };
            ui.lines?.appendChild(el);
          });
        } else if (lyrics.plain) {
          ui.lines.innerHTML = `<div class="bfs-line" style="cursor:default; opacity:1; filter:none; transform:none; white-space: pre-wrap;">${lyrics.plain}</div>`;
        }
      };

      const syncLyrics = (time: number) => {
        if (!lyrics?.lines || !ui.lines) return;
        
        const offset = config.perfectSync ? 0.5 : 0;
        const timeMs = (time + offset) * 1000; 
        
        let activeIdx = -1;
        for (let i = 0; i < lyrics.lines.length; i++) {
          if (timeMs >= lyrics.lines[i].timeMs) activeIdx = i;
          else break;
        }
        
        const domLines = ui.lines.querySelectorAll('.bfs-line');
        let isInstrumental = false;

        domLines.forEach((line: any, idx) => {
          if (idx === activeIdx) {
            if (!line.classList.contains('active')) {
              line.classList.add('active');
              line.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            if(line.classList.contains('instrumental')) isInstrumental = true;
          } else {
            line.classList.remove('active');
          }
        });

        if(isInstrumental) ui.viz?.classList.add('show');
        else ui.viz?.classList.remove('show');
      };

      const performFetch = async (title: string, artist: string, duration: number) => {
         lyrics = await getLyrics(title, artist, duration, config.romanize);
         renderLyrics();
      };

      const formatTime = (s: number) => {
        if (isNaN(s)) return "0:00";
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec < 10 ? '0' : ''}${sec}`;
      };

      setInterval(async () => {
        const video = document.querySelector('video');
        if (!video) return;

        const title = (document.querySelector('ytmusic-player-bar .title') as HTMLElement)?.innerText;
        let artist = (document.querySelector('ytmusic-player-bar .byline') as HTMLElement)?.innerText;
        const artSrc = (document.querySelector('.image.ytmusic-player-bar') as HTMLImageElement)?.src;
        if(artist) artist = artist.split(/[•·]/)[0].trim();

        if (ui.title && title) ui.title.innerText = title;
        if (ui.artist && artist) ui.artist.innerText = artist;

        if (ui.art && artSrc) {
           const highRes = artSrc.replace(/w\d+-h\d+/, 'w1200-h1200');
           if (ui.art.src !== highRes) {
             ui.art.src = highRes;
             ui.art.onload = updateColors;
           }
        }

        const currentSrc = video.src;
        if (currentSrc && currentSrc !== lastSrc) {
           lastSrc = currentSrc;
           retryCount = 0;
           if (title && artist) {
               ui.lines!.innerHTML = '<div class="bfs-empty">Searching lyrics...</div>';
               performFetch(title, artist, video.duration);
           }
        }

        if (isFullscreen) {
          ui.curr!.innerText = formatTime(video.currentTime);
          ui.dur!.innerText = formatTime(video.duration);
          const pct = (video.currentTime / video.duration) * 100;
          ui.fill!.style.width = `${pct}%`;
          syncLyrics(video.currentTime);

          if (video.paused) {
            ui.iconPlay!.style.display = 'block';
            ui.iconPause!.style.display = 'none';
          } else {
            ui.iconPlay!.style.display = 'none';
            ui.iconPause!.style.display = 'block';
          }
        }
      }, 250);

      const toggleFS = (active: boolean) => {
        isFullscreen = active;
        if (active) {
          document.body.classList.add('bfs-active');
          document.documentElement.requestFullscreen().catch(()=>{});
        } else {
          document.body.classList.remove('bfs-active');
          if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
        }
      };

      document.getElementById('bfs-close')?.addEventListener('click', () => toggleFS(false));
      window.addEventListener('keydown', e => {
        if(e.key === 'F12') toggleFS(!isFullscreen);
        if(e.key === 'Escape') toggleFS(false);
      });

      ui.settingsBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        ui.settingsModal?.classList.toggle('active');
      });
      ui.container?.addEventListener('click', (e) => {
        if(e.target !== ui.settingsBtn && !ui.settingsModal?.contains(e.target as Node)) {
           ui.settingsModal?.classList.remove('active');
        }
      });

      ui.optSync?.addEventListener('change', (e) => {
        config.perfectSync = (e.target as HTMLInputElement).checked;
        ctx.setConfig(config);
      });

      ui.optRoman?.addEventListener('change', async (e) => {
        config.romanize = (e.target as HTMLInputElement).checked;
        ctx.setConfig(config);
        const title = ui.title?.innerText;
        const artist = ui.artist?.innerText;
        const video = document.querySelector('video');
        if(title && artist && video) {
           ui.lines!.innerHTML = '<div class="bfs-empty">Processing...</div>';
           performFetch(title, artist, video.duration);
        }
      });

      ui.playBtn?.addEventListener('click', () => { const v=document.querySelector('video'); if(v) v.paused?v.play():v.pause(); });
      ui.prevBtn?.addEventListener('click', () => (document.querySelector('.previous-button') as HTMLElement)?.click());
      ui.nextBtn?.addEventListener('click', () => (document.querySelector('.next-button') as HTMLElement)?.click());
      ui.seek?.addEventListener('click', (e) => {
          const v = document.querySelector('video'); if(!v)return;
          const rect = ui.seek!.getBoundingClientRect();
          v.currentTime = ((e.clientX - rect.left) / rect.width) * v.duration;
      });

      // --- MOVED TO ALBUM ART ---
      setInterval(() => {
        const artContainer = document.querySelector('#song-image');
        
        if (artContainer && !document.getElementById('bfs-trigger')) {
          const btn = document.createElement('div');
          btn.id = 'bfs-trigger';
          btn.title = 'Open Lyrics (Better Fullscreen)';
          btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
          
          btn.onclick = (e) => { 
            e.stopPropagation(); 
            toggleFS(true); 
          };
          
          if(getComputedStyle(artContainer).position === 'static') {
             (artContainer as HTMLElement).style.position = 'relative';
          }
          
          artContainer.appendChild(btn);
        }
      }, 1000);
    }
  }
});