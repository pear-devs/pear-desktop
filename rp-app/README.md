# Discord Rich Presence Controller

A simple Electron app to set custom Discord Rich Presence status.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the app:
   ```bash
   npm start
   ```

## Usage

1. **Get a Discord Application ID**:
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application (or use an existing one)
   - Copy the "Application ID" from the General Information page

2. **Set up Rich Presence Assets** (optional):
   - In your Discord application, go to "Rich Presence" → "Art Assets"
   - Upload images you want to use for large/small icons
   - Note the asset names for use in the app

3. **Connect and Customize**:
   - Paste your Application ID in the app
   - Click "Connect"
   - Fill in the fields you want to display
   - Click "Update Presence"

## Fields

| Field | Description | Max Length |
|-------|-------------|------------|
| Details | First line of text | 128 chars |
| State | Second line of text | 128 chars |
| Large Image | Asset name or image URL | - |
| Large Image Text | Hover text for large image | 128 chars |
| Small Image | Asset name or image URL | - |
| Small Image Text | Hover text for small image | 128 chars |
| Button 1/2 Label | Button text | 32 chars |
| Button 1/2 URL | Button link | Valid URL |

## Activity Types

- **Playing** - "Playing {details}"
- **Streaming** - "Streaming {details}"
- **Listening** - "Listening to {details}"
- **Watching** - "Watching {details}"
- **Competing** - "Competing in {details}"

## Timestamps

- **Elapsed**: Shows "XX:XX elapsed"
- **Remaining**: Shows "XX:XX left" (requires duration)

## Notes

- Discord must be running for Rich Presence to work
- Buttons are only visible to other users (not yourself)
- Image URLs must be publicly accessible HTTPS URLs
- Changes may take a few seconds to appear in Discord

## Architecture

This app follows the same Discord RPC implementation pattern as [YouTube Music Desktop](https://github.com/pear-devs/pear-desktop):

```
src/
├── main/
│   ├── index.js          # Electron main process
│   ├── discord-service.js # Discord RPC service
│   ├── timer-manager.js   # Timer management
│   └── constants.js       # Constants
├── renderer/
│   ├── index.html        # UI
│   ├── styles.css        # Styles
│   └── renderer.js       # UI logic
└── preload.js            # IPC bridge
```

## License

MIT
