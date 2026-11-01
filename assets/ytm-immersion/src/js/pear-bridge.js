chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'YTMI_OPEN_OPTIONS') {
    window.open(chrome.runtime.getURL('src/options.html'), '_blank', 'noopener');
    return;
  }

  if (message?.type === 'YTMI_OPEN_URL' && typeof message.url === 'string') {
    try {
      const url = new URL(message.url);
      if (url.protocol === 'https:') window.open(url.href, '_blank', 'noopener');
    } catch {
      // Ignore malformed destinations.
    }
  }
});
