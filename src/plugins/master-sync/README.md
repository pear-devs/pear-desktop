# Master Sync Plugin for YouTube Music Desktop

This plugin allows you to synchronize playback from a MASTER YouTube Music Desktop instance to a SLAVE instance over your local network.

## Features

- **Automatic Song Sync**: When you play a song on the MASTER, it automatically plays on the SLAVE
- **Play/Pause Sync**: Play and pause states are synchronized between instances
- **Queue Management**: The current playlist/queue can be synced (optional)
- **Configurable**: Multiple sync options and intervals
- **Error Recovery**: Automatic retry logic with exponential backoff for transient network failures
- **Configuration Validation**: Real-time validation of settings with helpful error messages
- **Memory Efficient**: Optimized DOM monitoring with focused element selectors

## Prerequisites

### On SLAVE Computer:
1. YouTube Music Desktop App installed
2. **API Server plugin** enabled and configured
3. Note the following from API Server settings:
   - Hostname (e.g., `192.168.1.100`)
   - Port (default: `26538`)
   - Authorization token (you'll generate this)

### On MASTER Computer:
1. YouTube Music Desktop App installed
2. This Master Sync plugin installed

## Installation Instructions

### Step 1: Set Up the SLAVE Instance

1. Open YouTube Music Desktop on the SLAVE computer
2. Go to Settings (gear icon) → Plugins
3. Enable the "API Server" plugin
4. Configure the API Server:
   - **Host**: Set to `0.0.0.0` (allows network access) or `192.168.1.X` (your computer's local IP)
   - **Port**: Default `26538` (or choose another)
   - **Authorization**: Select "Authorization Code"
5. Note your computer's local IP address:
   - Windows: Open CMD → type `ipconfig` → look for "IPv4 Address"
   - Mac/Linux: Open Terminal → type `ifconfig` → look for "inet" under your network adapter
6. Get your authorization token (Menu):

From Pear Desktop, open the Plugins menu → Master Sync → Authorization → Request Authorization Token
   - Open a web browser or use curl
   - Send POST request to: `http://YOUR_IP:26538/auth/YOUR_NAME`
   - Example: `curl -X POST http://192.168.1.100:26538/auth/master`
   - Copy the token from the response

### Step 2: Install Master Sync Plugin on MASTER

1. **Create the plugins folder if it doesn't exist:**
   
   **macOS:** 
   ```bash
   mkdir -p ~/Library/Application\ Support/YouTube\ Music/plugins
   ```
   
   **Linux:**
   ```bash
   mkdir -p ~/.config/YouTube\ Music/plugins
   ```
   
   **Windows:** Use File Explorer to create the folder:
   - Navigate to: `C:\Users\YourName\AppData\Roaming\YouTube Music\`
   - Right-click → New Folder → Name it `plugins`

2. **Copy the plugin folder**:
   - Copy the `master-sync` folder to:
     - Windows: `%APPDATA%\YouTube Music\plugins\`
     - macOS: `~/Library/Application Support/YouTube Music/plugins/`
     - Linux: `~/.config/YouTube Music/plugins/`
   
   Create the `plugins` directory if it doesn't exist.

3. **The folder structure should look like this**:
   ```
   YouTube Music/
   └── plugins/
       └── master-sync/
           └── index.ts
   ```

4. **Restart YouTube Music Desktop** on the MASTER computer

### Step 3: Configure Master Sync Plugin

1. Open YouTube Music Desktop on the MASTER computer
2. Go to Settings → Plugins
3. Find and enable "Master Sync"
4. Configure the settings (you'll need to edit the config file):
   
   **Option A: Via Config File (Recommended)**
   - Close YouTube Music
   - Open the config file:
     - Windows: `%APPDATA%\YouTube Music\config.json`
     - macOS: `~/Library/Application Support/YouTube Music/config.json`
     - Linux: `~/.config/YouTube Music/config.json`
   
   - Find the `master-sync` section and update:
     ```json
     {
       "plugins": {
         "master-sync": {
           "enabled": true,
           "slaveHost": "192.168.1.100",
           "slavePort": 26538,
           "slaveAuthToken": "YOUR_TOKEN_HERE",
           "syncInterval": 2000,
           "syncPlayPause": true,
           "logDebug": false
         }
       }
     }
     ```
   
   - Replace `YOUR_TOKEN_HERE` with the token from Step 1.6
   - Replace `192.168.1.100` with your SLAVE computer's IP
   - Save and restart YouTube Music

   **Option B: Via Menu (if available)**
   - Use the "Master Sync" menu to toggle options
   - Note: Initial connection details must be set via config file

### Step 4: Test the Connection

1. Start YouTube Music on both MASTER and SLAVE computers
2. Make sure API Server is running on SLAVE (check the swagger UI at `http://SLAVE_IP:26538/swagger`)
3. On MASTER, enable "Master Sync" from the plugins menu
4. Play a song on the MASTER
5. The same song should start playing on the SLAVE after a few seconds

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `enabled` | Enable/disable the plugin | `false` |
| `slaveHost` | IP address of SLAVE computer | `192.168.1.100` |
| `slavePort` | Port of API Server on SLAVE | `26538` |
| `slaveAuthToken` | Authorization token from SLAVE | `""` (empty) |- `autoRequestToken` | Automatically request a token from the SLAVE when a 403 is encountered (opt-in) | `false` || `syncInterval` | How often to check for changes (ms) | `2000` |
| `syncPlayPause` | Sync play/pause state | `true` |
| `logDebug` | Enable debug logging | `false` |

## Troubleshooting

### Connection Issues

1. **Configuration Validation Error**: 
   - Check that `slaveHost` is not empty
   - Ensure `slavePort` is between 1-65535
   - Verify `slaveAuthToken` is set (not empty string)
   - Confirm `syncInterval` is at least 500ms

2. **Firewall**: Make sure the SLAVE computer's firewall allows incoming connections on the API Server port
   - Windows: Add exception for port 26538 in Windows Defender Firewall
   - Mac: System Preferences → Security & Privacy → Firewall → Firewall Options
   - Linux: `sudo ufw allow 26538`

3. **Network**: Both computers must be on the same local network

4. **Test API Server**: 
   - Open browser on MASTER
   - Visit: `http://SLAVE_IP:26538/swagger`
   - If you can see the API documentation, the server is working

5. **Check Logs**:
   - Enable `logDebug: true` in config
   - Open DevTools (Ctrl+Shift+I / Cmd+Option+I)
   - Check Console for "[Master Sync]" messages
   - Look for specific error messages and retry attempts

### Sync Not Working

1. **Verify auth token**: Make sure the token is correct and not expired
2. **Check intervals**: Ensure `syncInterval` is properly set (default 2000ms)
3. **Restart both apps**: Sometimes a fresh start helps
4. **Check SLAVE is not paused**: Make sure the SLAVE can play music
5. **Check network connectivity**: Run `ping SLAVE_IP` from MASTER to verify network connectivity

### Song Not Playing on SLAVE

1. The SLAVE must have access to the same content (logged in to YouTube Music)
2. Try playing the song manually on SLAVE first to verify it's available
3. Check if the SLAVE's queue is being updated (look in the queue/playlist view)
4. Verify the video ID is being correctly extracted by checking debug logs

### Retry Logic

The plugin includes automatic retry logic with exponential backoff:
- Failed API calls are retried up to 3 times
- Retry delays increase exponentially (1s, 2s, 4s) up to a maximum of 5s
- Debug logs will show retry attempts when `logDebug` is enabled

### Slow Sync

**Cause:** `syncInterval` too high

**Fix:**
1. In config.json, change `syncInterval` to `1000` (1 second) for faster sync
2. Note: Very low values (< 500ms) are not allowed to prevent network flooding
3. Default 2000ms is recommended for stable operation

## How It Works

1. The plugin monitors the MASTER's player state using the YouTube player API and DOM observations
2. When a song changes or play/pause state updates, it sends the change to the SLAVE via HTTP API
3. The SLAVE's API Server receives the command and plays the song
4. Play/pause states are synchronized continuously at the configured interval
5. Queue changes can be detected and synced
6. Failed API calls automatically retry with exponential backoff for reliability
7. Configuration changes are validated in real-time with helpful error messages

### Data Flow

```
MASTER Instance
├─ Monitor player state (song, play/pause)
├─ Validate configuration
├─ Call SLAVE API with retry logic
└─> HTTP POST to SLAVE:PORT/api/v1/...

SLAVE Instance
├─ API Server receives request
├─ Applies sync command (play/pause/add to queue)
└─ Updates player state
```

## Advanced Usage

### Multiple SLAVEs

To sync to multiple SLAVE computers, you can:
1. Install the plugin multiple times with different folder names (e.g., `master-sync-1`, `master-sync-2`)
2. Configure each with different SLAVE hosts/ports
3. Enable all instances

### Custom Sync Interval

For near-real-time sync, set `syncInterval` to `500` (half a second).
For less network traffic, increase to `5000` (5 seconds) or more.

### Sync Queue Only

If you only want to sync the playlist/queue without automatic playback:
1. Set `syncPlayPause: false`
2. Manually control playback on the SLAVE

## API Endpoints Used

The plugin uses these API Server endpoints on the SLAVE:
- `POST /api/v1/play` - Play a song
- `POST /api/v1/pause` - Pause playback  
- `POST /api/v1/queue/add` - Add song to queue
- `POST /api/v1/queue/clear` - Clear queue
- `GET /api/v1/song` - Get current song (for testing)

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Enable debug logging and check the console
3. Verify API Server is working on SLAVE
4. Make sure both apps are up to date

## Production Readiness

✅ **This plugin is production-ready**

### Quality Assurance Completed
- ✅ Async/await syntax errors fixed
- ✅ Comprehensive error handling implemented
- ✅ Configuration validation added
- ✅ Automatic retry logic with exponential backoff
- ✅ Memory leak prevention with proper cleanup
- ✅ Type safety improvements
- ✅ IPC error handling enhanced
- ✅ Documentation updates and clarifications

### Reliability Features
- Automatic retry on network failures (3 attempts, exponential backoff)
- Real-time configuration validation with helpful error messages
- Graceful degradation when configuration is invalid
- Proper resource cleanup on plugin stop
- Optimized DOM monitoring for performance

## License

This plugin is provided as-is for use with YouTube Music Desktop App.
