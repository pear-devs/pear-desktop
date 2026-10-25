export interface PlaybackSpeedSliderProps {
  displaySpeed: number;
  max: number;
  min: number;
  speed: number;
  step: number;
  title: string;
  onImmediateValueChanged?: (value: number) => void;
  onChange?: (value: number) => void;
  onWheel?: (event: WheelEvent) => void;
}

const getSliderValue = (event: Event) => {
  const slider = event.target as unknown as { value?: number };
  return Number(slider?.value);
};

export const PlaybackSpeedSlider = (props: PlaybackSpeedSliderProps) => (
  <div
    aria-disabled="false"
    aria-selected="false"
    class="style-scope menu-item ytmusic-menu-popup-renderer"
    role="option"
    tabindex="-1"
  >
    <div
      class="yt-simple-endpoint style-scope ytmusic-menu-navigation-item-renderer"
      id="navigation-endpoint"
      tabindex="-1"
    >
      <tp-yt-paper-slider
        aria-disabled="false"
        aria-label={props.title}
        aria-valuemax={props.max}
        aria-valuemin={props.min}
        aria-valuenow={props.speed}
        class="volume-slider style-scope ytmusic-player-bar on-hover"
        dir="ltr"
        max={props.max}
        min={props.min}
        on:change={(e) => props.onChange?.(getSliderValue(e))}
        on:immediate-value-changed={(e) =>
          props.onImmediateValueChanged?.(
            Number((e as CustomEvent<{ value?: number }>).detail?.value),
          )
        }
        onWheel={(e) => props.onWheel?.(e)}
        role="slider"
        step={props.step}
        style={{ 'display': 'inherit !important' }}
        tabindex="0"
        title={props.title}
        value={props.speed}
      >
        <div class="style-scope tp-yt-paper-slider" id="sliderContainer">
          <div class="bar-container style-scope tp-yt-paper-slider">
            <tp-yt-paper-progress
              aria-disabled="false"
              aria-hidden="true"
              aria-valuemax="2"
              aria-valuemin="0"
              aria-valuenow="1"
              class="style-scope tp-yt-paper-slider"
              id="sliderBar"
              role="progressbar"
              style={{ 'touch-action': 'none' }}
              value="1"
            >
              <div
                class="style-scope tp-yt-paper-progress"
                id="progressContainer"
              >
                <div
                  class="style-scope tp-yt-paper-progress"
                  hidden={true}
                  id="secondaryProgress"
                  style={{ 'transform': 'scaleX(0)' }}
                />
                <div
                  class="style-scope tp-yt-paper-progress"
                  id="primaryProgress"
                  style={{ 'transform': 'scaleX(0.5)' }}
                />
              </div>
            </tp-yt-paper-progress>
          </div>
          <div
            class="slider-knob style-scope tp-yt-paper-slider"
            id="sliderKnob"
            style={{ 'left': '50%', 'touch-action': 'none' }}
          >
            <input
              class="slider-knob-inner style-scope tp-yt-paper-slider"
              value={1}
            />
          </div>
        </div>
      </tp-yt-paper-slider>
      <div
        class="text style-scope ytmusic-menu-navigation-item-renderer"
        id="ytmcustom-playback-speed"
      >
        {props.title} ({props.displaySpeed})
      </div>
    </div>
  </div>
);
