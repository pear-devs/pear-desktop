// Animation lyrics logic extracted from lyrics-ui.js
// Loaded before lyrics-ui.js via manifest content_scripts order.

let animatedCaptionData = null;
let animatedCaptionFrameKey = '';
let animatedHtmlCaptionState = null;

const isTimedTextXml = (text) => (
  typeof text === 'string' &&
  /<timedtext\b/i.test(text) &&
  /<body\b/i.test(text) &&
  /<p\b/i.test(text)
);

const isAnimatedHtmlLyrics = (text) => (
  typeof text === 'string' &&
  /class=["'][^"']*\blyric\b/i.test(text) &&
  /class=["'][^"']*\bchar\b/i.test(text) &&
  /animation-delay\s*:/i.test(text)
);

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseCssTimeToMs = (rawValue) => {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  const match = raw.match(/(-?\d*\.?\d+)\s*(ms|s)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return match[2].toLowerCase() === 's' ? value * 1000 : value;
};

const getFirstCsvValue = (raw) => String(raw || '').split(',')[0].trim();

const extractAnimationDelayMs = (el) => {
  if (!el || typeof el.getAttribute !== 'function') return null;
  const styleAttr = String(el.getAttribute('style') || '');
  const styleMatch = styleAttr.match(/animation-delay\s*:\s*([^;]+)/i);
  if (styleMatch) {
    const firstValue = getFirstCsvValue(styleMatch[1]);
    const parsed = parseCssTimeToMs(firstValue);
    if (Number.isFinite(parsed)) return parsed;
  }

  const dataDelay = el.getAttribute('data-delay');
  const parsedDataDelay = parseCssTimeToMs(dataDelay);
  if (Number.isFinite(parsedDataDelay)) return parsedDataDelay;

  return null;
};

const parseCssDeclarations = (block) => {
  const out = {};
  String(block || '').split(';').forEach((chunk) => {
    const idx = chunk.indexOf(':');
    if (idx <= 0) return;
    const key = chunk.slice(0, idx).trim().toLowerCase();
    const value = chunk.slice(idx + 1).trim();
    if (!key || !value) return;
    out[key] = value;
  });
  return out;
};

const mergeCssRuleDeclarations = (cssText, selector) => {
  const out = {};
  const re = new RegExp(`${escapeRegExp(selector)}(?![\\w-])\\s*\\{([^{}]*)\\}`, 'gi');
  let match;
  while ((match = re.exec(String(cssText || '')))) {
    Object.assign(out, parseCssDeclarations(match[1]));
  }
  return out;
};

const parseVhValue = (raw) => {
  const match = String(raw || '').trim().match(/^(-?\d*\.?\d+)\s*vh$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const parsePercentValue = (raw) => {
  const match = String(raw || '').trim().match(/^(-?\d*\.?\d+)\s*%$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const parsePxValue = (raw) => {
  const match = String(raw || '').trim().match(/^(-?\d*\.?\d+)\s*px$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const parseVwValue = (raw) => {
  const match = String(raw || '').trim().match(/^(-?\d*\.?\d+)\s*vw$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const getBraceBlockAt = (text, openBraceIndex) => {
  const src = String(text || '');
  if (openBraceIndex < 0 || src[openBraceIndex] !== '{') return null;
  let depth = 0;
  for (let i = openBraceIndex; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return src.slice(openBraceIndex + 1, i);
      }
    }
  }
  return null;
};

const extractKeyframesBlock = (cssText, animationName) => {
  if (!animationName) return null;
  const src = String(cssText || '');
  const headerRe = new RegExp(`@keyframes\\s+${escapeRegExp(animationName)}\\b`, 'i');
  const headerMatch = headerRe.exec(src);
  if (!headerMatch) return null;
  const headerEnd = (headerMatch.index || 0) + headerMatch[0].length;
  const openBrace = src.indexOf('{', headerEnd);
  if (openBrace < 0) return null;
  return getBraceBlockAt(src, openBrace);
};

const parseTranslateYVh = (declarationsText) => {
  const match = String(declarationsText || '')
    .match(/transform\s*:\s*[^;]*translateY\(\s*(-?\d*\.?\d+)\s*vh\s*\)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const parseAnimationShorthand = (rawAnimation) => {
  const result = { name: '', durationMs: null, delayMs: null };
  const raw = getFirstCsvValue(rawAnimation);
  if (!raw) return result;

  const tokens = raw.split(/\s+/).filter(Boolean);
  const ignored = new Set([
    'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
    'step-start', 'step-end', 'infinite',
    'normal', 'reverse', 'alternate', 'alternate-reverse',
    'forwards', 'backwards', 'both', 'none', 'running', 'paused'
  ]);

  const times = [];
  tokens.forEach((token) => {
    const t = parseCssTimeToMs(token);
    if (Number.isFinite(t)) {
      times.push(t);
      return;
    }

    const tokenLower = token.toLowerCase();
    if (ignored.has(tokenLower)) return;
    if (/^steps\(/i.test(tokenLower) || /^cubic-bezier\(/i.test(tokenLower)) return;
    if (/^\d/.test(tokenLower)) return;
    if (!result.name) result.name = token;
  });

  result.durationMs = times.length ? times[0] : null;
  result.delayMs = times.length > 1 ? times[1] : null;
  return result;
};

const parseScrollAnimationSpec = (cssText) => {
  const scrollDecl = mergeCssRuleDeclarations(cssText, '.scroll-layer');
  if (!scrollDecl || Object.keys(scrollDecl).length === 0) return null;

  const shorthand = parseAnimationShorthand(scrollDecl.animation || '');
  const name = getFirstCsvValue(scrollDecl['animation-name']) || shorthand.name;
  const durationMs = parseCssTimeToMs(getFirstCsvValue(scrollDecl['animation-duration']))
    ?? shorthand.durationMs;
  const delayMs = parseCssTimeToMs(getFirstCsvValue(scrollDecl['animation-delay']))
    ?? shorthand.delayMs
    ?? 0;

  if (!name || !Number.isFinite(durationMs) || durationMs <= 0) return null;

  const keyframesBlock = extractKeyframesBlock(cssText, name);
  if (!keyframesBlock) {
    return { name, delayMs, durationMs, fromVh: 0, toVh: 0 };
  }

  let fromVh = 0;
  let toVh = 0;
  const frameRe = /(from|to|\d{1,3}%?)\s*\{([^{}]*)\}/gi;
  let frameMatch;
  while ((frameMatch = frameRe.exec(keyframesBlock))) {
    const key = String(frameMatch[1] || '').trim().toLowerCase();
    const body = frameMatch[2] || '';
    const y = parseTranslateYVh(body);
    if (!Number.isFinite(y)) continue;

    if (key === 'from' || key === '0%') fromVh = y;
    if (key === 'to' || key === '100%') toVh = y;
  }

  return { name, delayMs, durationMs, fromVh, toVh };
};

const resolveHtmlLyricNodeStyle = (node, cssText, baseLyricDecl) => {
  const style = { ...(baseLyricDecl || {}) };

  const classList = Array.from(node?.classList || []);
  classList
    .filter(name => /^lyric-\d+$/i.test(name))
    .forEach((className) => {
      const decl = mergeCssRuleDeclarations(cssText, `.${className}`);
      Object.assign(style, decl);
    });

  Object.assign(style, parseCssDeclarations(node?.getAttribute('style') || ''));
  return style;
};

const calcScrollOffsetVhAt = (scrollSpec, timeSec) => {
  if (!scrollSpec || !Number.isFinite(timeSec)) return 0;
  const delaySec = (Number.isFinite(scrollSpec.delayMs) ? scrollSpec.delayMs : 0) / 1000;
  const durationSec = Math.max(0.001, (Number.isFinite(scrollSpec.durationMs) ? scrollSpec.durationMs : 0) / 1000);
  if (timeSec <= delaySec) return scrollSpec.fromVh;

  const p = Math.max(0, Math.min(1, (timeSec - delaySec) / durationSec));
  return scrollSpec.fromVh + ((scrollSpec.toVh - scrollSpec.fromVh) * p);
};

const timedTextNumberAttr = (el, name, fallback = null) => {
  const raw = el ? el.getAttribute(name) : null;
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const normalizeTimedTextCaption = (text) => (
  String(text || '')
    .replace(/\u200B/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
);

const parseTimedTextStyleMap = (root, tagName) => {
  const out = new Map();
  root.querySelectorAll(tagName).forEach((el) => {
    const id = el.getAttribute('id');
    if (!id) return;
    const attrs = {};
    Array.from(el.attributes || []).forEach((attr) => {
      attrs[attr.name] = attr.value;
    });
    out.set(String(id), attrs);
  });
  return out;
};

const extractTimedTextSegments = (node, inheritedPenId = '') => {
  const segments = [];
  const walk = (current, penId) => {
    Array.from(current.childNodes || []).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = String(child.nodeValue || '').replace(/\u200B/g, '').replace(/\uFEFF/g, '');
        if (text.trim()) segments.push({ text, penId });
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const nextPenId = child.getAttribute('p') || penId;
      walk(child, nextPenId);
    });
  };
  walk(node, inheritedPenId);
  return segments;
};

const buildTimedTextPlainLines = (events) => {
  const lines = [];
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  events.forEach((event) => {
    const text = normalizeTimedTextCaption(event.text);
    const norm = normalize(text);
    if (!norm) return;

    const last = lines[lines.length - 1];
    if (last && event.time <= (last.endTime || last.time) + 0.35) {
      const lastNorm = normalize(last.text);
      if (norm === lastNorm) return;
      if (norm.includes(lastNorm) || lastNorm.includes(norm)) {
        if (norm.length >= lastNorm.length) {
          last.time = event.time;
          last.endTime = event.endTime;
          last.text = text;
        }
        return;
      }
    }

    lines.push({
      time: event.time,
      endTime: event.endTime,
      text,
    });
  });

  return lines.map(({ time, text }) => ({ time, text }));
};

const parseTimedTextAnimation = (xmlText) => {
  if (typeof DOMParser === 'undefined') return null;

  if (isAnimatedHtmlLyrics(xmlText)) {
    try {
      const doc = new DOMParser().parseFromString(xmlText, 'text/html');
      doc.querySelectorAll('script, noscript').forEach((node) => node.remove());
      const cssText = Array.from(doc.querySelectorAll('style')).map(node => node.textContent || '').join('\n');
      const baseLyricDecl = mergeCssRuleDeclarations(cssText, '.lyric');
      const scrollSpec = parseScrollAnimationSpec(cssText);
      const lyricNodes = Array.from(doc.querySelectorAll('.lyric'));
      const events = [];

      lyricNodes.forEach((node, index) => {
        const nodeStyle = resolveHtmlLyricNodeStyle(node, cssText, baseLyricDecl);
        const charNodes = Array.from(node.querySelectorAll('.char'));
        const segments = [];
        let startMs = null;
        let maxMs = null;

        charNodes.forEach((charNode) => {
          const segmentText = String(charNode.textContent || '').replace(/\u200B/g, '').replace(/\uFEFF/g, '');
          if (!segmentText) return;

          const delayMs = extractAnimationDelayMs(charNode);
          if (Number.isFinite(delayMs)) {
            if (!Number.isFinite(startMs) || delayMs < startMs) startMs = delayMs;
            if (!Number.isFinite(maxMs) || delayMs > maxMs) maxMs = delayMs;
          }

          segments.push({
            text: segmentText,
            penId: '',
            atMs: Number.isFinite(delayMs) ? delayMs : null,
          });
        });

        let text = normalizeTimedTextCaption(segments.map(s => s.text).join(''));
        if (!text) text = normalizeTimedTextCaption(node.getAttribute('data-text') || '');
        if (!text) text = normalizeTimedTextCaption(node.textContent || '');
        if (!text) return;

        if (!Number.isFinite(startMs)) {
          startMs = Number.isFinite(maxMs) ? maxMs : index * 1000;
        }
        if (!Number.isFinite(maxMs)) maxMs = startMs;

        segments.forEach((segment, segmentIndex) => {
          if (Number.isFinite(segment.atMs)) return;
          segment.atMs = startMs + (segmentIndex * 40);
        });

        const segmentMax = segments.reduce((max, seg) => {
          if (!Number.isFinite(seg.atMs)) return max;
          return Math.max(max, seg.atMs);
        }, maxMs);
        if (Number.isFinite(segmentMax)) maxMs = segmentMax;

        const minDurationMs = 120;
        const endMs = Math.max(startMs + 60, maxMs + minDurationMs);

        events.push({
          id: index,
          time: startMs / 1000,
          endTime: endMs / 1000,
          startMs,
          endMs,
          durationMs: Math.max(60, endMs - startMs),
          text,
          segments: segments.length ? segments : [{ text, penId: '', atMs: startMs }],
          penId: '',
          wpId: '',
          wsId: '',
          pen: {},
          window: {},
          windowStyle: {},
          htmlCue: {
            top: nodeStyle.top || '',
            left: nodeStyle.left || '',
            fontSize: nodeStyle['font-size'] || '',
            writingMode: nodeStyle['writing-mode'] || '',
            textOrientation: nodeStyle['text-orientation'] || '',
            letterSpacing: nodeStyle['letter-spacing'] || '',
            lineHeight: nodeStyle['line-height'] || '',
            color: nodeStyle.color || '',
            textShadow: nodeStyle['text-shadow'] || '',
            whiteSpace: nodeStyle['white-space'] || '',
          },
        });
      });

      if (!events.length) return null;
      events.sort((a, b) => a.startMs - b.startMs || a.id - b.id);
      events.forEach((event, idx) => {
        const next = events[idx + 1];
        if (next && Number.isFinite(next.startMs) && next.startMs > event.startMs) {
          event.endMs = Math.max(event.startMs + 60, Math.min(event.endMs, next.startMs - 1));
          event.endTime = event.endMs / 1000;
          event.durationMs = Math.max(60, event.endMs - event.startMs);
        }
      });

      return {
        pens: new Map(),
        windows: new Map(),
        windowStyles: new Map(),
        events,
        plainLines: buildTimedTextPlainLines(events),
        sourceType: 'html',
        scrollSpec,
      };
    } catch (e) {
      console.warn('Animated HTML parse failed', e);
      return null;
    }
  }

  if (!isTimedTextXml(xmlText)) return null;

  try {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) return null;
    const root = doc.querySelector('timedtext');
    if (!root) return null;

    const pens = parseTimedTextStyleMap(root, 'pen');
    const windows = parseTimedTextStyleMap(root, 'wp');
    const windowStyles = parseTimedTextStyleMap(root, 'ws');
    const events = [];

    root.querySelectorAll('body > p').forEach((p, index) => {
      const startMs = timedTextNumberAttr(p, 't', null);
      const durationMs = timedTextNumberAttr(p, 'd', 0);
      if (startMs === null) return;

      const penId = p.getAttribute('p') || '';
      const wpId = p.getAttribute('wp') || '';
      const wsId = p.getAttribute('ws') || '';
      const segments = extractTimedTextSegments(p, penId);
      const text = normalizeTimedTextCaption(segments.map(s => s.text).join(''));
      if (!text) return;

      events.push({
        id: index,
        time: startMs / 1000,
        endTime: (startMs + Math.max(60, durationMs || 0)) / 1000,
        startMs,
        endMs: startMs + Math.max(60, durationMs || 0),
        durationMs,
        text,
        segments: segments.length ? segments : [{ text, penId }],
        penId,
        wpId,
        wsId,
        pen: pens.get(String(penId)) || {},
        window: windows.get(String(wpId)) || {},
        windowStyle: windowStyles.get(String(wsId)) || {},
      });
    });

    if (!events.length) return null;
    events.sort((a, b) => a.startMs - b.startMs || a.id - b.id);

    return {
      pens,
      windows,
      windowStyles,
      events,
      plainLines: buildTimedTextPlainLines(events),
      sourceType: 'timedtext',
      scrollSpec: null,
    };
  } catch (e) {
    console.warn('TimedText parse failed', e);
    return null;
  }
};

const getTimedTextAnchorTransform = (anchorPoint) => {
  const ap = Number(anchorPoint);
  const map = {
    0: 'translate(0, 0)',
    1: 'translate(-50%, 0)',
    2: 'translate(-100%, 0)',
    3: 'translate(0, -50%)',
    4: 'translate(-50%, -50%)',
    5: 'translate(-100%, -50%)',
    6: 'translate(0, -100%)',
    7: 'translate(-50%, -100%)',
    8: 'translate(-100%, -100%)',
  };
  return map[ap] || 'translate(-50%, -50%)';
};

const getTimedTextAlign = (windowStyle) => {
  const ju = Number(windowStyle?.ju);
  if (ju === 0) return 'left';
  if (ju === 2) return 'right';
  return 'center';
};

const getTimedTextScaledFontSize = (rawSize, fallback = 140) => {
  const numeric = Number(rawSize);
  const sourceSize = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  return Math.max(20, Math.min(98, sourceSize * 0.30));
};

const getAnimatedCaptionFontScale = () => {
  const fallback = 3.4;
  try {
    if (!ui?.lyrics || typeof getComputedStyle !== 'function') return fallback;
    const raw = getComputedStyle(ui.lyrics).getPropertyValue('--ytm-animated-font-scale');
    const value = Number(String(raw || '').trim());
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return value;
  } catch {
    return fallback;
  }
};

const getHtmlCueTopCss = (event, currentTimeSec) => {
  const topRaw = event?.htmlCue?.top || '';
  const baseTopVh = parseVhValue(topRaw);
  if (!Number.isFinite(baseTopVh)) return topRaw;

  const scrollSpec = animatedCaptionData?.scrollSpec || null;
  const offsetVh = calcScrollOffsetVhAt(scrollSpec, Number.isFinite(currentTimeSec) ? currentTimeSec : 0);
  const topVh = baseTopVh + offsetVh;
  return `${topVh.toFixed(3)}vh`;
};

const getTimedTextCueStyle = (event, currentTimeSec = 0) => {
  if (event?.htmlCue) {
    const cue = event.htmlCue;
    const scale = getAnimatedCaptionFontScale();

    const fontSizeRaw = String(cue.fontSize || '').trim();
    const vh = parseVhValue(fontSizeRaw);
    const scaledFontSize = Number.isFinite(vh)
      ? `${(vh * scale).toFixed(3)}vh`
      : (fontSizeRaw || `${(48 * scale).toFixed(2)}px`);

    const left = cue.left || '50%';
    const top = getHtmlCueTopCss(event, currentTimeSec) || '50%';

    return [
      `left:${left}`,
      `top:${top}`,
      'transform:translate(0, 0)',
      `font-size:${scaledFontSize}`,
      cue.color ? `color:${cue.color}` : 'color:#FEFEFE',
      cue.textShadow ? `text-shadow:${cue.textShadow}` : 'text-shadow:0 2px 10px rgba(0,0,0,.72)',
      cue.writingMode ? `writing-mode:${cue.writingMode}` : '',
      cue.textOrientation ? `text-orientation:${cue.textOrientation}` : '',
      cue.letterSpacing ? `letter-spacing:${cue.letterSpacing}` : '',
      cue.lineHeight ? `line-height:${cue.lineHeight}` : '',
      cue.whiteSpace ? `white-space:${cue.whiteSpace}` : 'white-space:pre',
      'text-align:left',
      'animation:none',
      'will-change:auto',
      'opacity:1',
    ].filter(Boolean).join(';');
  }

  const pen = event.pen || {};
  const win = event.window || {};
  const left = timedTextNumberAttr({ getAttribute: n => win[n] }, 'ah', 50);
  const top = timedTextNumberAttr({ getAttribute: n => win[n] }, 'av', 80);
  const scale = getAnimatedCaptionFontScale();
  const baseFontSize = getTimedTextScaledFontSize(pen.sz, 140);
  const fontSize = baseFontSize * scale;
  const opacity = pen.fo !== undefined ? Math.max(0, Math.min(1, Number(pen.fo) / 254)) : 1;
  const color = /^#[0-9a-f]{6}$/i.test(pen.fc || '') ? pen.fc : '#FEFEFE';
  const edgeColor = /^#[0-9a-f]{6}$/i.test(pen.ec || '') ? pen.ec : '#000000';
  const textShadow = pen.ec
    ? `0 0 2px ${edgeColor}, 0 2px 8px rgba(0,0,0,.72)`
    : '0 2px 10px rgba(0,0,0,.72)';

  return [
    `left:${left}%`,
    `top:${top}%`,
    `transform:${getTimedTextAnchorTransform(win.ap)}`,
    `--ytm-animated-base-font-size:${baseFontSize}px`,
    `font-size:${fontSize}px`,
    `color:${color}`,
    `opacity:${opacity}`,
    `text-shadow:${textShadow}`,
    `text-align:${getTimedTextAlign(event.windowStyle)}`,
    pen.i === '1' ? 'font-style:italic' : '',
  ].filter(Boolean).join(';');
};

const getTimedTextSegmentHtml = (event, currentTimeSec = 0) => {
  if (event?.htmlCue && Array.isArray(event.segments) && event.segments.length) {
    const currentMs = Math.max(0, (Number(currentTimeSec) || 0) * 1000);
    return event.segments.map((segment) => {
      const atMs = Number.isFinite(segment.atMs) ? segment.atMs : event.startMs;
      const visible = atMs <= currentMs + 16;
      const style = visible ? '' : ' style="opacity:0"';
      return `<span${style}>${escapeHtml(segment.text)}</span>`;
    }).join('');
  }

  const scale = getAnimatedCaptionFontScale();
  return (event.segments || [{ text: event.text, penId: event.penId }]).map((segment) => {
    const pen = animatedCaptionData?.pens?.get(String(segment.penId || event.penId)) || event.pen || {};
    const color = /^#[0-9a-f]{6}$/i.test(pen.fc || '') ? pen.fc : '';
    const opacity = pen.fo !== undefined ? Math.max(0, Math.min(1, Number(pen.fo) / 254)) : null;
    const size = Number(pen.sz || 0);
    const style = [
      color ? `color:${color}` : '',
      opacity !== null ? `opacity:${opacity}` : '',
      size ? `font-size:${(getTimedTextScaledFontSize(size, size) * scale).toFixed(2)}px` : '',
      pen.i === '1' ? 'font-style:italic' : '',
    ].filter(Boolean).join(';');
    return `<span${style ? ` style="${style}"` : ''}>${escapeHtml(segment.text)}</span>`;
  }).join('');
};

const cleanupAnimatedHtmlCaption = () => {
  animatedHtmlCaptionState = null;
};

function renderAnimatedTimedText(captionData) {
  if (!ui.lyrics || !captionData) return;
  cleanupAnimatedHtmlCaption();
  animatedCaptionData = captionData;
  animatedCaptionFrameKey = '';
  hasTimestamp = true;
  document.body.classList.remove('ytm-no-lyrics', 'ytm-no-timestamp');
  document.body.classList.add('ytm-has-timestamp', 'ytm-animated-caption-mode');
  ui.lyrics.innerHTML = '<div class="ytm-animated-caption-stage" aria-live="off"></div>';
  const now = getCurrentPlaybackTimeSec();
  updateAnimatedCaptionStage(typeof now === 'number' ? now : 0, true);
}

function updateAnimatedCaptionStage(currentTime, force = false) {
  if (!animatedCaptionData || !ui.lyrics) return;
  const stage = ui.lyrics.querySelector('.ytm-animated-caption-stage');
  if (!stage) return;

  const tMs = Math.max(0, (Number(currentTime) || 0) * 1000);
  const active = animatedCaptionData.events
    .filter(event => tMs + 40 >= event.startMs && tMs <= event.endMs + 40)
    .slice(-24);

  const isHtmlSource = animatedCaptionData.sourceType === 'html';
  const timeBucket = isHtmlSource ? Math.floor(tMs / 40) : -1;
  const key = `${timeBucket}|${active.map(event => `${event.id}:${event.startMs}:${event.endMs}`).join('|')}`;
  if (!force && key === animatedCaptionFrameKey) return;

  animatedCaptionFrameKey = key;
  stage.innerHTML = active.map(event => (
    `<div class="ytm-animated-caption-cue" style="${getTimedTextCueStyle(event, currentTime)}">${getTimedTextSegmentHtml(event, currentTime)}</div>`
  )).join('');
}
