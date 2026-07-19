# Slowed & Nightcore Plugin

Adds an interactive floating panel to easily apply "Slowed" or "Nightcore" effects to tracks.

## Features
* **Playback Speed Control:** Precision slider from 0.5x to 1.5x.
* **Pitch Preservation:** Toggle to keep the original pitch or let it deepen/raise with the speed (true slowed/nightcore effect).
* **Presets:** Quick buttons for standard Slowed, Nightcore, and Reset.
* **Persistent Settings:** Preserves your chosen speed and pitch settings across track changes seamlessly.

## Compatibility Note
This plugin operates strictly via the HTML5 `<video>` element properties (`playbackRate` and `preservesPitch`). It explicitly avoids the Web Audio API to guarantee 100% compatibility with other audio-hijacking plugins (like native Equalizers or Crossfade).