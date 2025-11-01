export interface PictureInPictureButtonProps {
  onClick?: (e: MouseEvent) => void;
  text: string;
}

export const PictureInPictureButton = (props: PictureInPictureButtonProps) => (
  <a
    class="yt-simple-endpoint style-scope ytmusic-menu-navigation-item-renderer"
    id="navigation-endpoint"
    onClick={(e) => props.onClick?.(e)}
    tabindex={-1}
  >
    <div class="icon ytmd-menu-item style-scope ytmusic-menu-navigation-item-renderer">
      <svg
        class="style-scope yt-icon"
        id="Layer_1"
        style={{
          'pointer-events': 'none',
          'display': 'block',
          'width': '100%',
          'height': '100%',
        }}
        viewBox="0 0 512 512"
        x="0px"
        xmlns="http://www.w3.org/2000/svg"
        y="0px"
      >
        <g class="style-scope yt-icon" id="XMLID_6_">
          <path
            class="style-scope yt-icon"
            d="M418.5,139.4H232.4v139.8h186.1V139.4z M464.8,46.7H46.3C20.5,46.7,0,68.1,0,93.1v325.9
              c0,25.8,21.4,46.3,46.3,46.3h419.4c25.8,0,46.3-20.5,46.3-46.3V93.1C512,67.2,490.6,46.7,464.8,46.7z M464.8,418.9H46.3V92.2h419.4
              v326.8H464.8z"
            fill="#aaaaaa"
            id="XMLID_11_"
          />
        </g>
      </svg>
    </div>
    <div
      class="text style-scope ytmusic-menu-navigation-item-renderer"
      id="ytmcustom-pip"
    >
      {props.text}
    </div>
  </a>
);
