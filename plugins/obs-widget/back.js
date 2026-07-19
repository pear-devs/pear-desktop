const {ipcMain} = require("electron");
const http = require("http");
const registerCallback = require("../../providers/song-info");

let currentSongInfo;
const data = {
	player: {
		hasSong: false,
		isPaused: true,
		seekbarCurrentPosition: 0,
	},
	track: {
		author: [],
		title: "",
		album: "",
		cover: "",
		duration: 0,
	}
};

/** @param {Electron.BrowserWindow} win */
module.exports = async (win) => {
	const requestListener = function (req, res) {
		if(req.url !== '/query'){
			res.writeHead(404);
			res.end("404 Not found!");
		}
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.writeHead(200);
		if (currentSongInfo !== undefined && !currentSongInfo.title && !currentSongInfo.artist) {
			res.end(JSON.stringify({}));
			return;
		}
                Object.assign(data, {
                    player: {
                        hasSong: true,
                        isPaused: currentSongInfo.isPaused,
                        seekbarCurrentPosition: currentSongInfo.elapsedSeconds
                    },
                    track: {
                        author: [currentSongInfo.artist],
                        title: currentSongInfo.title,
                        album: currentSongInfo.album,
                        cover: currentSongInfo.cover,
                        duration: currentSongInfo.duration
                    }
                });
		res.end(JSON.stringify(data));
	};
	const server = http.createServer(requestListener);
	server.listen(9863, "localhost", () => {
	});
	ipcMain.on('apiLoaded', () => win.webContents.send('setupTimeChangedListener'));
	ipcMain.on('timeChanged', async (_, t) => {
		if (!currentSongInfo.title || currentSongInfo.isPaused) return;
		currentSongInfo.elapsedSeconds = t;
	});

	registerCallback((songInfo) => {
		currentSongInfo = songInfo;
	});
};
