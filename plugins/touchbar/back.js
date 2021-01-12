const { TouchBar } = require("electron");
const {
	TouchBarButton,
	TouchBarLabel,
	TouchBarSpacer,
	TouchBarSegmentedControl,
	TouchBarScrubber,
} = TouchBar;

// Songtitle label
const songTitle = new TouchBarLabel({
	label: "",
});
// This will store the song controls once available
let controls = [];

// This will store the song image once available
const songImage = {};

// Pause/play button
const pausePlayButton = new TouchBarButton();

// The song control buttons (control functions are in the same order)
const buttons = new TouchBarSegmentedControl({
	mode: "buttons",
	segments: [
		new TouchBarButton({
			label: "⏮",
		}),
		pausePlayButton,
		new TouchBarButton({
			label: "⏭",
		}),
		new TouchBarButton({
			label: "👎",
		}),
		new TouchBarButton({
			label: "👍",
		}),
	],
	change: (i) => controls[i](),
});

// This is the touchbar object, this combines everything with proper layout
const touchBar = new TouchBar({
	items: [
		new TouchBarScrubber({
			items: [songImage, songTitle],
			continuous: false,
		}),
		new TouchBarSpacer({
			size: "flexible",
		}),
		buttons,
	],
});

module.exports = win => {
	// If the page is ready, register the callback
	win.on('ready-to-show', () => {
		controls = [
			global.songControls.previous,
			global.songControls.pause,
			global.songControls.next,
			global.songControls.like,
			global.songControls.dislike
		];

		// Register the callback
		global.songInfo.onNewData(songInfo => {
			// Song information changed, so lets update the touchBar

			// Set the song title
			songTitle.label = songInfo.title;

			// Changes the pause button if paused
			pausePlayButton.label = songInfo.isPaused ? "▶️" : "⏸";

			// Get image source
			songImage.icon = songInfo.image
				? songInfo.image.resize({ height: 23 })
				: null;

			win.setTouchBar(touchBar);
		});
	});
};
