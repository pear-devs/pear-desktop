export interface DislikeButtonProps {
  onClick?: (e: MouseEvent) => void;
  maskSize: string;
}

export const DislikeButton = (props: DislikeButtonProps) => (
  <div class="style-scope">
    <button
      aria-label="Dislike all"
      aria-pressed="false"
      class="like-menu yt-spec-button-shape-next yt-spec-button-shape-next--text yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-button"
      data-filled="false"
      data-type="dislike"
      id="alldislike"
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
          <div style={{ 'width': '24px', 'height': '24px' }}>
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
                  d="M18,4h3v10h-3V4z M5.23,14h4.23l-1.52,4.94C7.62,19.97,8.46,21,9.62,21c0.58,0,1.14-0.24,1.52-0.65L17,14V4H6.57 C5.5,4,4.59,4.67,4.38,5.61l-1.34,6C2.77,12.85,3.82,14,5.23,14z"
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
                d="M18,4h3v10h-3V4z M5.23,14h4.23l-1.52,4.94C7.62,19.97,8.46,21,9.62,21c0.58,0,1.14-0.24,1.52-0.65L17,14V4H6.57 C5.5,4,4.59,4.67,4.38,5.61l-1.34,6C2.77,12.85,3.82,14,5.23,14z"
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
