export interface KaraokeButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

export const KaraokeButton = (props: KaraokeButtonProps) => (
  <yt-icon-button
    aria-disabled={false}
    aria-label={props.label}
    aria-pressed={props.active}
    class="karaoke-button style-scope ytmusic-player-bar"
    classList={{ active: props.active }}
    icon={'yt-icons:microphone_on'}
    on:click={() => props.onClick()}
    role={'button'}
    tabindex={0}
    title={props.label}
  >
    <span class="yt-icon-shape style-scope yt-icon yt-spec-icon-shape">
      <svg
        class="style-scope yt-icon"
        fill="currentColor"
        preserveAspectRatio="xMidYMid meet"
        style={{ 'pointer-events': 'none', 'display': 'block' }}
        viewBox="0 0 24 24"
      >
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
      </svg>
    </span>
  </yt-icon-button>
);
