# Quick Start Guide - Master Sync Plugin

## Overview
This guide will help you set up music synchronization between two computers running YouTube Music Desktop.

---

## Part 1: Setup SLAVE Computer (Receiver)

### 1.1 Install YouTube Music Desktop
- Download and install from: https://github.com/th-ch/youtube-music/releases/latest

### 1.2 Enable API Server Plugin
1. Open YouTube Music Desktop
2. Click Settings (⚙️ gear icon)
3. Go to **Plugins** tab
4. Find **API Server** plugin
5. Toggle it **ON**
6. Click **Configure** or **Settings** for API Server

### 1.3 Configure API Server
Set these values:
- **Host**: `0.0.0.0` (allows network connections)
- **Port**: `26538` (default, or choose your own)
- **Authorization**: Select **"Authorization Code"**
- **CORS**: Enable if option exists

Click **Save**

### 1.4 Get Your Computer's IP Address

**Windows:**
```
1. Press Win+R
2. Type: cmd
3. Press Enter
4. Type: ipconfig
5. Look for "IPv4 Address" under your network adapter
   Example: 192.168.1.100
```

**Mac:**
```
1. Open System Preferences
2. Go to Network
3. Select your active connection (Wi-Fi or Ethernet)
4. Your IP address is shown on the right
   Example: 192.168.1.100
```

**Linux:**
```bash
hostname -I
# Or
ip addr show
```

**Write down your IP:** _________________ (you'll need this later)

### 1.5 Get Authorization Token

Open Terminal/Command Prompt and run:

```bash
curl -X POST http://YOUR_IP:26538/auth/master
```

Replace `YOUR_IP` with your actual IP address from step 1.4

**Example:**
```bash
curl -X POST http://192.168.1.100:26538/auth/master
```

**Windows Users (if curl is not available):**
1. Install curl from https://curl.se/windows/
2. Or use PowerShell instead:
```powershell
Invoke-WebRequest -Uri "http://YOUR_IP:26538/auth/master" -Method POST
```

**You should see a response like:**
```json
{
  "code": "abc123def456",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "name": "master"
}
```

**Copy the entire `token` value** (the long string starting with "eyJ...")

**Write down your token:** _________________ (you'll need this for MASTER setup)

### 1.6 Test API Server

Open a web browser and visit:
```
http://YOUR_IP:26538/swagger
```

You should see the API documentation page. If you do, the SLAVE is ready!

---

## Part 2: Setup MASTER Computer (Controller)

### 2.1 Download Plugin Files
You should have received a folder named `master-sync` containing:
- `index.ts`
- `README.md`
- `package.json`

### 2.2 Locate Plugins Directory

Find your YouTube Music plugins folder. **If it doesn't exist, create it first.**

**Windows:**
```
%APPDATA%\YouTube Music\plugins\
```
Full path: `C:\Users\YourName\AppData\Roaming\YouTube Music\plugins\`

To create if missing:
1. Open File Explorer
2. Paste the path above in the address bar
3. Right-click → New Folder → Name it `plugins`

**macOS:**
```
~/Library/Application Support/YouTube Music/plugins/
```

To create if missing, open Terminal and run:
```bash
mkdir -p ~/Library/Application\ Support/YouTube\ Music/plugins
```

**Linux:**
```
~/.config/YouTube Music/plugins/
```

To create if missing, open Terminal and run:
```bash
mkdir -p ~/.config/YouTube\ Music/plugins
```

**Important:** The `plugins` directory may not exist - you need to create it if it's missing!

### 2.3 Install Plugin

1. Copy the entire `master-sync` folder into the `plugins` directory
2. Your structure should be:
   ```
   YouTube Music/
   └── plugins/
       └── master-sync/
           ├── index.ts
           ├── README.md
           └── package.json
   ```

### 2.4 Configure Plugin

1. **Close YouTube Music** if it's open

2. Find and open the config file:
   - Windows: `%APPDATA%\YouTube Music\config.json`
   - macOS: `~/Library/Application Support/YouTube Music/config.json`
   - Linux: `~/.config/YouTube Music/config.json`

3. Open it with a text editor (Notepad, TextEdit, nano, etc.)

4. Look for the `"plugins"` section. If it doesn't exist, add it after the first `{`:

5. Add or modify the `master-sync` configuration:

```json
{
  "plugins": {
    "master-sync": {
      "enabled": true,
      "slaveHost": "PUT_SLAVE_IP_HERE",
      "slavePort": 26538,
      "slaveAuthToken": "PUT_YOUR_TOKEN_HERE",
      "syncInterval": 2000,
      "syncPlayPause": true,
      "logDebug": false
    }
  }
}
```

6. **Replace these values:**
   - `PUT_SLAVE_IP_HERE` → Your SLAVE computer's IP from Part 1, Step 1.4
   - `PUT_YOUR_TOKEN_HERE` → The token you copied in Part 1, Step 1.5

**Example:**
```json
{
  "plugins": {
    "master-sync": {
      "enabled": true,
      "slaveHost": "192.168.1.100",
      "slavePort": 26538,
      "slaveAuthToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoibWFzdGVyIiwiaWF0IjoxNjQwMDAwMDAwfQ.xxxxxxxxxxxxxxxxxxxxx",
      "syncInterval": 2000,
      "syncPlayPause": true,
      "logDebug": false
    }
  }
}
```

**Important Notes:**
- `syncInterval` must be at least 500ms (minimum), 2000ms is recommended
- `slavePort` must be between 1-65535 (default 26538)
- Don't include the token value with "eyJ..." twice - just copy the entire token string

7. **Save the file**

3. Open it with a text editor (Notepad, TextEdit, nano, etc.)

4. Look for the `"plugins"` section. If it doesn't exist, add it after the first `{`:

5. Add or modify the `master-sync` configuration:

```json
{
  "plugins": {
    "master-sync": {
      "enabled": true,
      "slaveHost": "PUT_SLAVE_IP_HERE",
      "slavePort": 26538,
      "slaveAuthToken": "PUT_YOUR_TOKEN_HERE",
      "syncInterval": 2000,
      "syncPlayPause": true,
      "logDebug": true
    }
  }
}
```

6. **Replace these values:**
   - `PUT_SLAVE_IP_HERE` → Your SLAVE computer's IP from Part 1, Step 1.4
   - `PUT_YOUR_TOKEN_HERE` → The token you copied in Part 1, Step 1.5

**Example:**
```json
{
  "plugins": {
    "master-sync": {
      "enabled": true,
      "slaveHost": "192.168.1.100",
      "slavePort": 26538,
      "slaveAuthToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoibWFzdGVyIiwiaWF0IjoxNjQwMDAwMDAwfQ.xxxxxxxxxxxxxxxxxxxxx",
      "syncInterval": 2000,
      "syncPlayPause": true,
      "logDebug": true
    }
  }
}
```

7. **Save the file**

### 2.5 Enable Plugin

1. Start YouTube Music Desktop
2. Go to Settings → Plugins
3. You should see **Master Sync** in the list
4. Make sure it's **enabled** (toggle ON)

---

## Part 3: Test the Synchronization

### 3.1 Start Both Applications

1. Make sure YouTube Music is running on **SLAVE** computer
2. Make sure YouTube Music is running on **MASTER** computer
3. Both should be logged in to YouTube Music

### 3.2 Test Sync

On the **MASTER** computer:
1. Play any song
2. Wait 2-3 seconds

On the **SLAVE** computer:
- The same song should start playing automatically! 🎵

### 3.3 Test Play/Pause Sync

On the **MASTER** computer:
1. Pause the song
2. Wait 2-3 seconds
3. The SLAVE should also pause

Try playing again - the SLAVE should resume!

### 3.4 Check Debug Logs (Optional)

If you want to see what's happening:

On **MASTER** computer:
1. In YouTube Music, press: `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac)
2. Click the **Console** tab
3. You should see messages like:
   ```
   [Master Sync] Song changed to: VIDEO_ID
   [Master Sync] Playback state changed to: playing
   ```

---

## Troubleshooting

### Issue: Plugin doesn't appear in settings

**Solution:**
1. Check folder structure is correct (see Part 2, Step 2.3)
2. Make sure `index.ts` is directly inside `master-sync` folder
3. Restart YouTube Music completely (close and reopen)

### Issue: Song doesn't play on SLAVE

**Solution:**
1. Test SLAVE API Server:
   - Open browser: `http://SLAVE_IP:26538/swagger`
   - Should show API documentation
2. Check firewall on SLAVE computer (see Firewall Setup below)
3. Verify both computers are on same network
4. Check that auth token is correct in config.json

### Issue: "Connection error" in logs

**Solution:**
1. Ping SLAVE from MASTER:
   ```bash
   ping SLAVE_IP
   ```
2. Should get replies. If not, network issue.
3. Try accessing: `http://SLAVE_IP:26538/swagger` from MASTER's browser

---

## Firewall Setup

### Windows (SLAVE Computer)

1. Open **Windows Defender Firewall**
2. Click **Advanced settings**
3. Click **Inbound Rules**
4. Click **New Rule**
5. Select **Port** → Next
6. Select **TCP**, enter port: `26538` → Next
7. Select **Allow the connection** → Next
8. Check all profiles → Next
9. Name: "YouTube Music API Server" → Finish

### macOS (SLAVE Computer)

1. System Preferences → Security & Privacy
2. Click Firewall tab
3. Click **Firewall Options**
4. Click **+** to add application
5. Select YouTube Music
6. Choose **Allow incoming connections**
7. Click **OK**

### Linux (SLAVE Computer)

```bash
sudo ufw allow 26538/tcp
sudo ufw reload
```

---

## Configuration Options Explained

| Setting | What it does | Recommended |
|---------|-------------|-------------|
| `enabled` | Turn plugin on/off | `true` |
| `slaveHost` | SLAVE computer's IP address | Your SLAVE IP |
| `slavePort` | API Server port on SLAVE | `26538` |
| `slaveAuthToken` | Security token from SLAVE | From Part 1, Step 1.5 |
| `syncInterval` | How often to check for changes (milliseconds) | `2000` |
| `syncPlayPause` | Sync play/pause state | `true` |
| `logDebug` | Show detailed logs in console | `true` for testing, `false` when working |

---

## Advanced: Syncing to Multiple SLAVEs

To control multiple computers:

1. Set up each SLAVE (Part 1) and note their IPs and tokens
2. Create separate plugin folders:
   ```
   plugins/
   ├── master-sync-living-room/
   ├── master-sync-bedroom/
   └── master-sync-office/
   ```
3. Configure each in config.json with different IPs and tokens

---

## Need Help?

If you're still having issues:
1. Set `logDebug: true` in config
2. Open DevTools Console (`Ctrl+Shift+I`)
3. Look for `[Master Sync]` messages
4. Check error messages

Common issues:
- **Firewall blocking** → Allow port 26538
- **Wrong IP/port** → Double-check SLAVE settings
- **Invalid token** → Generate new token on SLAVE
- **Different networks** → Both must be on same Wi-Fi/LAN

---

## Success!

If everything is working:
- Songs played on MASTER automatically play on SLAVE ✅
- Play/pause is synchronized ✅
- You can control multiple rooms from one computer ✅

Enjoy your synchronized music experience! 🎵🎶
