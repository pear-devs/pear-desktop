# SFW Music

Enable **Plugins → SFW Music** to automatically skip songs marked Explicit by
YouTube Music. It also checks the current song when enabled and can be turned
off without restarting the app.

Directly selecting a song with an Explicit badge is blocked before it starts,
leaving the current song playing.

Explicit tracks are paused before advancing. If an entirely explicit queue
repeats, or there is no next song, playback stays paused.

This uses YouTube Music's Explicit metadata, so unlabelled content is not
filtered. Detection happens when track metadata becomes available; a brief
start of audio may be heard before a skip.
