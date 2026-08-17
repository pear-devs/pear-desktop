export type SkipAiMusicMenuItemProps = {
  id: string;
  label: string;
  onClick?: (event: MouseEvent) => void;
  pathD: string;
};

export const SkipAiMusicMenuItem = (props: SkipAiMusicMenuItemProps) => (
  <a
    class="yt-simple-endpoint style-scope ytmusic-menu-navigation-item-renderer"
    id="navigation-endpoint"
    onClick={(event) => props.onClick?.(event)}
    tabindex={-1}
  >
    <div class="icon skip-ai-music-menu-icon style-scope ytmusic-menu-navigation-item-renderer">
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
            d={props.pathD}
            fill="#aaaaaa"
          />
        </g>
      </svg>
    </div>
    <div
      class="text style-scope ytmusic-menu-navigation-item-renderer"
      id={props.id}
    >
      {props.label}
    </div>
  </a>
);
