/**
 * Searches for the video button and forces it to be selected if it is not already.
 */
export function forceVideoMode() {
  const avToggle = document.querySelector('ytmusic-av-toggle');
  if (!avToggle) return;

  const videoButton = document.querySelector('button.video-button');
  if (!videoButton) return;

  const hasVideo = avToggle.hasAttribute('selected-item-has-video');
  const isSelected = videoButton.getAttribute('aria-pressed') === 'true';

  if (!isSelected && hasVideo) {
    (videoButton as HTMLElement).click();
    console.log('[Cinemode] Video mode selected.');
  }
}
