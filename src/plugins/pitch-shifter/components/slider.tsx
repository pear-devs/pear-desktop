import { MAX_SEMITONES, MIN_SEMITONES, formatSemitones } from '../constants';

export interface PitchSliderProps {
  semitones: number;
  title: string;
  onChange?: (semitones: number) => void;
  onWheel?: (event: WheelEvent) => void;
}

const position = (semitones: number) =>
  (semitones - MIN_SEMITONES) / (MAX_SEMITONES - MIN_SEMITONES);

export const PitchSlider = (props: PitchSliderProps) => (
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
        aria-valuemax={MAX_SEMITONES}
        aria-valuemin={MIN_SEMITONES}
        aria-valuenow={props.semitones}
        class="volume-slider style-scope ytmusic-player-bar on-hover"
        dir="ltr"
        max={MAX_SEMITONES}
        min={MIN_SEMITONES}
        on:immediate-value-changed={(e: CustomEvent<{ value: number }>) =>
          props.onChange?.(Number(e.detail.value))
        }
        onWheel={(e) => props.onWheel?.(e)}
        role="slider"
        step="1"
        style={{ 'display': 'inherit !important', 'width': '140px' }}
        tabindex="0"
        title={props.title}
        value={props.semitones}
      >
        <div class="style-scope tp-yt-paper-slider" id="sliderContainer">
          <div class="bar-container style-scope tp-yt-paper-slider">
            <tp-yt-paper-progress
              aria-disabled="false"
              aria-hidden="true"
              aria-valuemax={MAX_SEMITONES}
              aria-valuemin={MIN_SEMITONES}
              aria-valuenow={props.semitones}
              class="style-scope tp-yt-paper-slider"
              id="sliderBar"
              role="progressbar"
              style={{ 'touch-action': 'none' }}
              value={props.semitones}
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
                  style={{
                    'transform': `scaleX(${position(props.semitones)})`,
                  }}
                />
              </div>
            </tp-yt-paper-progress>
          </div>
          <div
            class="slider-knob style-scope tp-yt-paper-slider"
            id="sliderKnob"
            style={{
              'left': `${position(props.semitones) * 100}%`,
              'touch-action': 'none',
            }}
          >
            <input
              class="slider-knob-inner style-scope tp-yt-paper-slider"
              value={props.semitones}
            />
          </div>
        </div>
      </tp-yt-paper-slider>
      <div
        class="text style-scope ytmusic-menu-navigation-item-renderer"
        id="ytmcustom-pitch-shifter"
        style={{ 'white-space': 'nowrap' }}
      >
        {props.title} ({formatSemitones(props.semitones)})
      </div>
    </div>
  </div>
);
