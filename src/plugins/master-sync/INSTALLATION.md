# Master Sync Plugin - Installation & Usage Instructions

## What This Plugin Does

The Master Sync plugin enables you to synchronize music playback between two YouTube Music Desktop instances:
- **MASTER** (Controller): The computer where you control playback
- **SLAVE** (Receiver): The computer that mirrors the MASTER's playback

When you play a song on the MASTER, it automatically plays the same song on the SLAVE. Play, pause, and playlist changes are synchronized.

---

## Files Included

Your download contains:
```
master-sync/
├── index.ts              - Main plugin code
├── package.json          - Plugin metadata
├── README.md             - Detailed documentation
├── QUICKSTART.md         - Step-by-step setup guide
└── config-example.json   - Example configuration
```

---

## Installation Locations

### Where to Install the Plugin

Copy the entire `master-sync` folder to your plugins directory. **Create the plugins folder if it doesn't exist.**

**Windows:**
```
C:\Users\[YourUsername]\AppData\Roaming\YouTube Music\plugins\master-sync\
```

To create the plugins folder if missing:
1. Open File Explorer
2. Navigate to: `C:\Users\[YourUsername]\AppData\Roaming\YouTube Music\`
3. Right-click → New Folder → Name it `plugins`
4. Copy `master-sync` folder into it

**macOS:**
```
~/Library/Application Support/YouTube Music/plugins/master-sync/
```

To create the plugins folder if missing, open Terminal and run:
```bash
mkdir -p ~/Library/Application\ Support/YouTube\ Music/plugins
```

**Linux:**
```
~/.config/YouTube Music/plugins/master-sync/
```

To create the plugins folder if missing, open Terminal and run:
```bash
mkdir -p ~/.config/YouTube\ Music/plugins
```

### Where to Edit Configuration

Edit the config file at:

**Windows:**
```
C:\Users\[YourUsername]\AppData\Roaming\YouTube Music\config.json
```

**macOS:**
```
~/Library/Application Support/YouTube Music/config.json
```

**Linux:**
```
~/.config/YouTube Music/config.json
```

---

## Quick Installation Steps

### SLAVE Computer Setup (5 minutes)

1. **Install YouTube Music Desktop** (if not already installed)
   - Download: https://github.com/th-ch/youtube-music/releases/latest

2. **Enable API Server Plugin**
   - Settings → Plugins → Enable "API Server"
   - Configure:
     - Host: `0.0.0.0`
     - Port: `26538`
     - Authorization: "Authorization Code"

3. **Get Your IP Address**
   - Windows: Run `ipconfig` in CMD
   - Mac/Linux: Run `hostname -I` in Terminal
   - Note your IP (e.g., 192.168.1.100)

4. **Generate Auth Token**
   ```bash
   curl -X POST http://YOUR_IP:26538/auth/master
   ```
   
   **Windows Users (if curl is not available):**
   ```powershell
   Invoke-WebRequest -Uri "http://YOUR_IP:26538/auth/master" -Method POST
   ```
   
   - Copy the `token` value from the response

### MASTER Computer Setup (5 minutes)

1. **Install the Plugin**
   - Copy `master-sync` folder to plugins directory (see locations above)

2. **Configure the Plugin**
   - Close YouTube Music
   - Open `config.json` in text editor
   - Add this section (or modify if exists):

```json
{
  "plugins": {
    "master-sync": {
      "enabled": true,
      "slaveHost": "SLAVE_IP_HERE",
      "slavePort": 26538,
      "slaveAuthToken": "TOKEN_FROM_SLAVE_HERE",
      "syncInterval": 2000,
      "syncPlayPause": true,
      "logDebug": false
    }
  }
}
```

   - Replace `SLAVE_IP_HERE` with SLAVE's IP address
   - Replace `TOKEN_FROM_SLAVE_HERE` with token from step 4 above
   - Save and close

3. **Start YouTube Music**
   - The plugin will automatically load
   - Check Settings → Plugins to verify "Master Sync" is enabled

### Test It

1. Play a song on MASTER
2. After 2-3 seconds, it should play on SLAVE
3. Pause on MASTER → SLAVE pauses too
4. Play on MASTER → SLAVE plays too

---

## Configuration Reference

| Setting | Description | Example |
|---------|-------------|---------|
| `enabled` | Enable/disable the plugin | `true` |
| `slaveHost` | IP address of SLAVE computer | `"192.168.1.100"` |
| `slavePort` | API Server port on SLAVE (1-65535) | `26538` |
| `slaveAuthToken` | Authorization token from SLAVE | `"eyJhbGci..."` |
| `syncInterval` | Check interval in milliseconds (minimum 500) | `2000` |
| `syncPlayPause` | Sync play/pause state | `true` |
| `logDebug` | Enable debug logging | `false` |

---

## Troubleshooting

### Plugin doesn't appear in Settings

**Cause:** Installation path incorrect or file structure wrong

**Fix:**
1. Verify folder structure:
   ```
   YouTube Music/plugins/master-sync/index.ts
   ```
2. Restart YouTube Music completely

### Can't connect to SLAVE

**Cause:** Firewall, wrong IP, or API Server not running

**Fix:**
1. Test from browser: `http://SLAVE_IP:26538/swagger`
2. Should show API documentation
3. If not accessible:
   - Check SLAVE's firewall settings
   - Verify both computers on same network
   - Confirm API Server plugin is enabled on SLAVE

### Songs don't sync

**Cause:** Wrong token, API Server authorization issue

**Fix:**
1. Re-generate token on SLAVE:
   ```bash
   curl -X POST http://SLAVE_IP:26538/auth/master-new
   ```
2. Update `slaveAuthToken` in MASTER's config.json
3. Restart YouTube Music on MASTER

### Sync is slow

**Cause:** `syncInterval` too high

**Fix:**
1. In config.json, change `syncInterval` to `1000` (1 second)
2. Restart YouTube Music

---

## Firewall Configuration

### Windows (SLAVE)

1. Windows Defender Firewall → Advanced Settings
2. Inbound Rules → New Rule
3. Port → TCP → 26538
4. Allow the connection
5. Apply to all profiles

### macOS (SLAVE)

1. System Preferences → Security & Privacy → Firewall
2. Firewall Options
3. Add YouTube Music application
4. Allow incoming connections

### Linux (SLAVE)

```bash
sudo ufw allow 26538/tcp
sudo ufw reload
```

---

## Advanced Usage

### Multiple SLAVEs

Create separate plugin instances:

1. Duplicate the plugin folder:
   ```
   plugins/
   ├── master-sync-room1/
   ├── master-sync-room2/
   └── master-sync-room3/
   ```

2. Configure each in config.json with different IPs and tokens

### Sync Queue/Playlist

The plugin monitors queue changes and syncs them automatically. No additional configuration needed.

### Custom Sync Intervals

- **Fast sync** (500ms): More responsive, more network traffic
- **Balanced** (2000ms): Default, good for most uses
- **Conservative** (5000ms): Less network traffic, slower updates

Edit `syncInterval` in config.json

---

## How It Works

### Data Flow

```
MASTER (Controller)
  │
  ├─ Detects song change
  ├─ Detects play/pause change
  ├─ Detects queue change
  │
  └─> HTTP Request to SLAVE API
       │
       └─> SLAVE (Receiver)
            ├─ API Server receives command
            ├─ Updates player state
            └─ Plays synchronized content
```

### API Endpoints Used

The plugin uses these API Server endpoints:

- `POST /api/v1/play` - Play a song
- `POST /api/v1/pause` - Pause playback
- `POST /api/v1/queue/add` - Add song to queue
- `POST /api/v1/queue/clear` - Clear queue
- `GET /api/v1/song` - Get current song info

### Security

- Uses bearer token authentication
- Token is generated on SLAVE and shared with MASTER
- Communication is HTTP (local network only)
- For internet use, consider setting up VPN

---

## Performance Considerations

### Network Requirements

- **Bandwidth**: Minimal (only sends commands, not audio)
- **Latency**: Low latency network recommended for smooth sync
- **Connections**: One HTTP request every `syncInterval` ms

### System Resources

- **CPU**: Negligible
- **Memory**: < 5MB
- **Network**: < 1KB per sync operation

---

## Limitations

1. **Same Network**: Both computers must be on same local network (or VPN)
2. **Account Access**: SLAVE must have access to the same YouTube Music content
3. **Manual Setup**: Initial configuration requires editing JSON file
4. **No Audio Streaming**: This syncs playback commands only, not the actual audio

---

## Future Enhancements

Possible improvements for future versions:
- GUI configuration panel
- Volume sync option
- Playback position sync
- Bi-directional sync
- Auto-discovery of SLAVE instances
- HTTPS support

---

## Support & Feedback

For issues or questions:

1. **Enable Debug Logging**
   - Set `logDebug: true`
   - Open DevTools (Ctrl+Shift+I)
   - Check Console for error messages

2. **Check Common Issues**
   - Review the Troubleshooting section
   - Verify network connectivity
   - Confirm firewall settings

3. **Documentation**
   - See QUICKSTART.md for detailed setup
   - See README.md for complete feature list

---

## License

MIT License - Free to use and modify

---

## Version

Current Version: 1.0.0

Created for YouTube Music Desktop App

Compatible with: API Server plugin v3.7.5+

---

## Changelog

### v1.0.0 (Initial Release)
- Song synchronization
- Play/pause sync
- Queue management
- Configurable sync interval
- Debug logging
- Menu integration

---

Enjoy synchronized music across your home! 🎵
