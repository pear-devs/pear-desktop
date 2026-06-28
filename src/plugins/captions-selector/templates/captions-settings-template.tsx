export interface CaptionsSettingsButtonProps {
  label: string;
  onClick: (event: MouseEvent) => void;
}

export const CaptionsSettingButton = (props: CaptionsSettingsButtonProps) => (
  <yt-icon-button
    aria-disabled={false}
    aria-label={props.label}
    class="player-captions-button style-scope ytmusic-player-bar"
    icon={'yt-icons:subtitles'}
    on:click={(e) => props.onClick(e)}
    role={'button'}
    tabindex={0}
    title={props.label}
  >
    <span class="yt-icon-shape style-scope yt-icon yt-spec-icon-shape">
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          fill: 'currentcolor',
        }}
      >
        <svg
          class="style-scope yt-icon"
          preserveAspectRatio="xMidYMid meet"
          style={{
            'pointer-events': 'none',
            'display': 'block',
            'width': '100%',
            'height': '100%',
          }}
          viewBox="0 0 24 24"
        >
          <g class="style-scope yt-icon">
            <path
              class="style-scope yt-icon"
              d="M20 4H4c-1.103 0-2 .897-2 2v12c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V6c0-1.103-.897-2-2-2zm-9 6H8v4h3v2H8c-1.103 0-2-.897-2-2v-4c0-1.103.897-2 2-2h3v2zm7 0h-3v4h3v2h-3c-1.103 0-2-.897-2-2v-4c0-1.103.897-2 2-2h3v2z"
            />
          </g>
        </svg>
      </div>
    </span>
  </yt-icon-button>
);
