export interface QualitySettingButtonProps {
  label: string;
  onClick: (event: MouseEvent) => void;
}

export const QualitySettingButton = (props: QualitySettingButtonProps) => (
  <yt-icon-button
    aria-disabled={false}
    aria-label={props.label}
    class="player-quality-button style-scope ytmusic-player"
    icon={'yt-icons:settings'}
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
              d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.1-1.65c.2-.15.25-.42.13-.64l-2-3.46c-.12-.22-.4-.3-.6-.22l-2.5 1c-.52-.4-1.08-.73-1.7-.98l-.37-2.65c-.06-.24-.27-.42-.5-.42h-4c-.27 0-.48.18-.5.42l-.4 2.65c-.6.25-1.17.6-1.7.98l-2.48-1c-.23-.1-.5 0-.6.22l-2 3.46c-.14.22-.08.5.1.64l2.12 1.65c-.04.32-.07.65-.07.98s.02.66.06.98l-2.1 1.65c-.2.15-.25.42-.13.64l2 3.46c.12.22.4.3.6.22l2.5-1c.52.4 1.08.73 1.7.98l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.6-.25 1.17-.6 1.7-.98l2.48 1c.23.1.5 0 .6-.22l2-3.46c.13-.22.08-.5-.1-.64l-2.12-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"
            />
          </g>
        </svg>
      </div>
    </span>
  </yt-icon-button>
);
