import { createSignal, Show } from 'solid-js';

export interface VideoSwitchButtonProps {
  initialVideoVisible?: boolean;
  onVideoToggle?: (showVideo: boolean) => void;
}

export const VideoSwitchButton = (props: VideoSwitchButtonProps) => {
  const [videoVisible, setVideoVisible] = createSignal(
    props.initialVideoVisible ?? true,
  );

  const toggleVideo = () => {
    const newVisible = !videoVisible();
    setVideoVisible(newVisible);
    props.onVideoToggle?.(newVisible);
  };

  return (
    <button class="video-switch-button" on:click={toggleVideo} type="button">
      <Show when={videoVisible()}>
        <svg
          class="video-toggle-icon"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </Show>
      <Show when={!videoVisible()}>
        <svg
          class="video-toggle-icon"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" x2="23" y1="1" y2="23" />
        </svg>
      </Show>
    </button>
  );
};
