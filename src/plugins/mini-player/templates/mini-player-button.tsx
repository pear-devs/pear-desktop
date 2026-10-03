export interface MiniPlayerButtonProps {
  onClick?: (e: MouseEvent) => void;
  text: string;
}

export const MiniPlayerButton = (props: MiniPlayerButtonProps) => (
  <a
    class="yt-simple-endpoint style-scope ytmusic-menu-navigation-item-renderer"
    id="navigation-endpoint"
    onClick={(e) => props.onClick?.(e)}
    tabindex={-1}
  >
    <div class="icon ytmd-menu-item style-scope ytmusic-menu-navigation-item-renderer">
      <svg
        class="style-scope yt-icon"
        style={{
          'pointer-events': 'none',
          'display': 'block',
          'width': '100%',
          'height': '100%',
        }}
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          class="style-scope yt-icon"
          d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v12h16V6H4Z"
          fill="#aaaaaa"
        />
        <path
          class="style-scope yt-icon"
          d="M11.5 11.5H19V17.5H11.5Z"
          fill="#aaaaaa"
        />
      </svg>
    </div>
    <div
      class="text style-scope ytmusic-menu-navigation-item-renderer"
      id="ytmcustom-mini-player"
    >
      {props.text}
    </div>
  </a>
);
