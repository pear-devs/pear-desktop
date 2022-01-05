const { setOptions } = require("../../config/plugins");
const { edit } = require("../../config");
const { clear, connect, registerRefresh, isConnected } = require("./back");

let hasRegisterred = false;

module.exports = (win, options, refreshMenu) => {
	if (!hasRegisterred) {
		registerRefresh(refreshMenu);
		hasRegisterred = true;
	}

	return [
		{
			label: isConnected() ? "Connected" : "Reconnect",
			enabled: !isConnected(),
			click: connect,
		},
		{
			label: "Clear activity",
			click: clear,
		},
		{
			label: "Clear activity after timeout",
			type: "checkbox",
			checked: options.activityTimoutEnabled,
			click: (item) => {
				options.activityTimoutEnabled = item.checked;
				setOptions('discord', options);
			},
		},
		{
			label: "Listen Along",
			type: "checkbox",
			checked: options.listenAlong,
			click: (item) => {
				options.listenAlong = item.checked;
				setOptions('discord', options);
			},
		},
		{
			label: "Set timeout time in config",
			// open config.json
			click: edit,
		},
	];
};
