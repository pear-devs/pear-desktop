export interface UnLikeButtonProps {
  onClick?: (e: MouseEvent) => void;
  maskSize: string;
}

export const UnLikeButton = (props: UnLikeButtonProps) => (
  <div class="style-scope">
    <button
      aria-label="Unlike all"
      aria-pressed="false"
      class="like-menu yt-spec-button-shape-next yt-spec-button-shape-next--text yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-button"
      data-filled="true"
      data-type="like"
      id="allunlike"
      onClick={(e) => props.onClick?.(e)}
    >
      <div
        aria-hidden="true"
        class="yt-spec-button-shape-next__icon"
        style={{
          'color': 'var(--ytmusic-setting-item-toggle-active)',
        }}
      >
        <div
          aria-hidden="true"
          class="yt-spec-button-shape-next__icon"
          style={{
            'color': 'white',
            'mask': 'linear-gradient(grey, grey)',
            '-webkit-mask': 'linear-gradient(grey, grey)',
            '-webkit-mask-size': props.maskSize,
            '-webkit-mask-repeat': 'no-repeat',
            'z-index': 1,
            'position': 'absolute',
          }}
        >
          <div
            style={{
              width: '24px',
              height: '24px',
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
                  d="M18.77,11h-4.23l1.52-4.94C16.38,5.03,15.54,4,14.38,4c-0.58,0-1.14,0.24-1.52,0.65L7,11H3v10h4h1h9.43 c1.06,0,1.98-0.67,2.19-1.61l1.34-6C21.23,12.15,20.18,11,18.77,11z M7,20H4v-8h3V20z M19.98,13.17l-1.34,6 C18.54,19.65,18.03,20,17.43,20H8v-8.61l5.6-6.06C13.79,5.12,14.08,5,14.38,5c0.26,0,0.5,0.11,0.63,0.3 c0.07,0.1,0.15,0.26,0.09,0.47l-1.52,4.94L13.18,12h1.35h4.23c0.41,0,0.8,0.17,1.03,0.46C19.92,12.61,20.05,12.86,19.98,13.17z"
                />
              </g>
            </svg>
          </div>
        </div>
        <div
          style={{
            width: '24px',
            height: '24px',
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
                d="M18.77,11h-4.23l1.52-4.94C16.38,5.03,15.54,4,14.38,4c-0.58,0-1.14,0.24-1.52,0.65L7,11H3v10h4h1h9.43 c1.06,0,1.98-0.67,2.19-1.61l1.34-6C21.23,12.15,20.18,11,18.77,11z M7,20H4v-8h3V20z M19.98,13.17l-1.34,6 C18.54,19.65,18.03,20,17.43,20H8v-8.61l5.6-6.06C13.79,5.12,14.08,5,14.38,5c0.26,0,0.5,0.11,0.63,0.3 c0.07,0.1,0.15,0.26,0.09,0.47l-1.52,4.94L13.18,12h1.35h4.23c0.41,0,0.8,0.17,1.03,0.46C19.92,12.61,20.05,12.86,19.98,13.17z"
              />
            </g>
          </svg>
        </div>
      </div>
      <yt-touch-feedback-shape
        style={{
          'border-radius': 'inherit',
        }}
      >
        <div
          aria-hidden="true"
          class="yt-spec-touch-feedback-shape yt-spec-touch-feedback-shape--touch-response"
        >
          <div class="yt-spec-touch-feedback-shape__stroke" />
          <div class="yt-spec-touch-feedback-shape__fill" />
        </div>
      </yt-touch-feedback-shape>
    </button>
  </div>
);
