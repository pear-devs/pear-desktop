const { ipcRenderer } = require("electron");
const { setOptions } = require("../../config/plugins");

function $(selector) { return document.querySelector(selector); }

module.exports = (options) => {
	setupPlaybar(options);
	setupSliderObserver(options);
	setupArrowShortcuts(options);
	firstRun(options);
	ipcRenderer.once("setupVideoPlayerVolumeMousewheel", (_event, toEnable) => {
		if (toEnable)
			setupVideoPlayerOnwheel(options);
	});
};

function setupVideoPlayerOnwheel(options){
	// Add onwheel event to video player
	$("#main-panel").onwheel = event => {
		event.preventDefault();
		// Event.deltaY < 0 means wheel-up
		changeVolume(event.deltaY < 0, options);
	};
}

function toPercent(volume) {
	return Math.round(Number.parseFloat(volume) * 100);
}

function saveVolume(volume, options) {
	options.savedVolume = volume;
	setOptions("precise-volume", options);
}

function firstRun(options) {
	const videoStream = $(".video-stream");
	const slider = $("#volume-slider");
	// Those elements load abit after DOMContentLoaded
	if (videoStream && slider) {
		// Set saved volume IF it pass checks
		if (options.savedVolume
			&& options.savedVolume >= 0 && options.savedVolume <= 100
			&& Math.abs(slider.value - options.savedVolume) < 5
			// If plugin was disabled and volume changed then diff>4
		) {
			videoStream.volume = options.savedVolume / 100;
			slider.value = options.savedVolume;
		}
		// Set current volume as tooltip
		setTooltip(toPercent(videoStream.volume));
	} else {
		setTimeout(firstRun, 500, options); // Try again in 500 milliseconds
	}
}

function setupPlaybar(options) {
	const playerbar = $("ytmusic-player-bar");
	// Add onwheel event to play bar
	playerbar.onwheel = event => {
		event.preventDefault();
		// Event.deltaY < 0 means wheel-up
		changeVolume(event.deltaY < 0, options);
	};

	// Keep track of mouse position for showVolumeSlider()
	playerbar.addEventListener("mouseenter", () => {
		playerbar.classList.add("on-hover");
	});

	playerbar.addEventListener("mouseleave", () => {
		playerbar.classList.remove("on-hover");
	});
}

// (increase = false) means volume decrease
function changeVolume(increase, options) {
	// Need to change both the actual volume and the slider
	const videoStream = $(".video-stream");
	const slider = $("#volume-slider");
	// Apply volume change if valid
	const steps = options.steps / 100;
	videoStream.volume = increase ?
		Math.min(videoStream.volume + steps, 1) :
		Math.max(videoStream.volume - steps, 0);

	// Save the new volume
	saveVolume(toPercent(videoStream.volume), options);
	// Slider value automatically rounds to multiples of 5
	slider.value = options.savedVolume;
	// Change tooltips to new value
	setTooltip(options.savedVolume);
	// Show volume slider on volume change
	showVolumeSlider(slider);
}

let volumeHoverTimeoutID;

function showVolumeSlider(slider) {
	// This class display the volume slider if not in minimized mode
	slider.classList.add("on-hover");
	 // Reset timeout if previous one hasn't completed
	if (volumeHoverTimeoutID) {
		clearTimeout(volumeHoverTimeoutID);
	}
	// Timeout to remove volume preview after 3 seconds if playbar isn't hovered
	volumeHoverTimeoutID = setTimeout(() => {
		volumeHoverTimeoutID = null;
		if (!$("ytmusic-player-bar").classList.contains("on-hover")) {
			slider.classList.remove("on-hover");
		}
	}, 3000);
}

// Save volume + Update the volume tooltip when volume-slider is manually changed
function setupSliderObserver(options) {
	const sliderObserver = new MutationObserver(mutations => {
		for (const mutation of mutations) {
			// This checks that volume-slider was manually set
			if (mutation.oldValue !== mutation.target.value &&
				(!options.savedVolume || Math.abs(options.savedVolume - mutation.target.value) > 4)) {
				// Diff>4 means it was manually set
				setTooltip(mutation.target.value);
				saveVolume(mutation.target.value, options);
			}
		}
	});

	// Observing only changes in 'value' of volume-slider
	sliderObserver.observe($("#volume-slider"), {
		attributeFilter: ["value"],
		attributeOldValue: true
	});
}

// Set new volume as tooltip for volume slider and icon + expanding slider (appears when window size is small)
const tooltipTargets = [
	"#volume-slider",
	"tp-yt-paper-icon-button.volume",
	"#expand-volume-slider",
	"#expand-volume"
];

function setTooltip(volume) {
	for (target of tooltipTargets) {
		$(target).title = `${volume}%`;
	}
}

function setupArrowShortcuts(options) {
	// Register shortcuts if enabled
	if (options.arrowsShortcut) {
		addListener();
	}

	// Change options from renderer to keep sync
	ipcRenderer.on("setArrowsShortcut", (_event, isEnabled) => {
		options.arrowsShortcut = isEnabled;
		setOptions("precise-volume", options);
		// This allows changing setting without restarting app
		if (isEnabled) {
			addListener();
		} else {
			removeListener();
		}
	});

	function addListener() {
		window.addEventListener('keydown', callback);
	}

	function removeListener() {
		window.removeEventListener("keydown", callback);
	}

	function callback(event) {
		event.preventDefault();
		switch (event.code) {
			case "ArrowUp":
				changeVolume(true, options);
				break;
			case "ArrowDown":
				changeVolume(false, options);
				break;
		}
	}
}
