# YTM-Immersion for Pear Desktop

This is a desktop integration of [YTM-Immersion](https://github.com/naikaku1/YTM_Immersion), version 3.0.2.
The upstream source and MIT license are included in this directory. See `NOTICE.md` for provenance.

Enable **YTM-Immersion** in Pear Desktop's plugin settings and restart the app. Use the in-player
`IMMERSION` button or `Alt+Shift+I` to switch views. The plugin menu includes a settings window.

Electron does not implement Chrome's optional-host-permission API. The bundled extension lists
the lyric-provider origins in its host permissions so those providers can work in the desktop
client. Provider switches remain available in the extension settings.
