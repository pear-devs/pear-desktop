import style from './style.css?inline';
import { createPlugin } from '@/utils';
import { onPlayerApiReady } from './renderer';
import { t } from '@/i18n';


/**
 * 🎵 Pitch Shifter Plugin (Tone.js + Solid.js Edition)
 * Author: TheSakyo
 *
 * Provides real-time pitch shifting for YouTube Music using Tone.js,
 * allowing users to raise or lower the key of a song dynamically.
 */
export type PitchShifterPluginConfig = {
	/** Whether the plugin is enabled (active in the player). */
	enabled: boolean;

	/** Current pitch shift amount in semitones (-12 to +12). */
	semitones: number;
};

export default createPlugin({
	// 🧱 ─────────────── Plugin Metadata ───────────────
	name: () => t('plugins.pitch-shifter.name', 'Pitch Shifter'),
	description: () => t('plugins.pitch-shifter.description'),

	/** Whether the app must restart when enabling/disabling the plugin. */
	restartNeeded: false,

	// ⚙️ ─────────────── Default Configuration ───────────────
	config: {
		enabled: false, // Plugin starts disabled by default
		semitones: 0,   // Neutral pitch (no shift)
	} as PitchShifterPluginConfig,

	// 🎨 ─────────────── Plugin Stylesheet ───────────────
	/** Inline CSS loaded into the YT Music renderer for consistent styling. */
	stylesheets: [style],

	// 🎧 ─────────────── Renderer Logic ───────────────
	/**
	 * The renderer is triggered once the YouTube Music player API is available.
	 * It handles all DOM interactions, UI injection, and audio processing.
	 */
	renderer: {
		onPlayerApiReady,
	},
});
