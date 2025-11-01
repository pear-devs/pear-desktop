import { css } from 'solid-styled-components';
import { Show } from 'solid-js';

import { IconButton } from './IconButton';
import { cacheNoArgs } from '@/providers/decorators';

const containerStyle = cacheNoArgs(
  () => css`
    display: flex;
    justify-content: flex-end;
    align-items: center;

    & > *:last-of-type {
      border-top-right-radius: 4px;

      &:hover {
        background: rgba(255, 0, 0, 0.5);
      }
    }
  `,
);

export type WindowControllerProps = {
  isMaximize?: boolean;

  onToggleMaximize?: () => void;
  onMinimize?: () => void;
  onClose?: () => void;
};
export const WindowController = (props: WindowControllerProps) => {
  return (
    <div class={containerStyle()}>
      <IconButton onClick={props.onMinimize}>
        <svg
          fill="none"
          height={16}
          viewBox="0 0 24 24"
          width={16}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3.755 12.5h16.492a.75.75 0 0 0 0-1.5H3.755a.75.75 0 0 0 0 1.5Z"
            fill="currentColor"
          />
        </svg>
      </IconButton>
      <IconButton onClick={props.onToggleMaximize}>
        <Show
          fallback={
            <svg
              fill="none"
              height={16}
              viewBox="0 0 24 24"
              width={16}
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H6Z"
                fill="currentColor"
              />
            </svg>
          }
          when={props.isMaximize}
        >
          <svg
            fill="none"
            height={16}
            viewBox="0 0 24 24"
            width={16}
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M7.518 5H6.009a3.25 3.25 0 0 1 3.24-3h8.001A4.75 4.75 0 0 1 22 6.75v8a3.25 3.25 0 0 1-3 3.24v-1.508a1.75 1.75 0 0 0 1.5-1.732v-8a3.25 3.25 0 0 0-3.25-3.25h-8A1.75 1.75 0 0 0 7.518 5ZM5.25 6A3.25 3.25 0 0 0 2 9.25v9.5A3.25 3.25 0 0 0 5.25 22h9.5A3.25 3.25 0 0 0 18 18.75v-9.5A3.25 3.25 0 0 0 14.75 6h-9.5ZM3.5 9.25c0-.966.784-1.75 1.75-1.75h9.5c.967 0 1.75.784 1.75 1.75v9.5a1.75 1.75 0 0 1-1.75 1.75h-9.5a1.75 1.75 0 0 1-1.75-1.75v-9.5Z"
              fill="currentColor"
            />
          </svg>
        </Show>
      </IconButton>
      <IconButton onClick={props.onClose}>
        <svg
          fill="none"
          height={16}
          viewBox="0 0 24 24"
          width={16}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="m4.21 4.387.083-.094a1 1 0 0 1 1.32-.083l.094.083L12 10.585l6.293-6.292a1 1 0 1 1 1.414 1.414L13.415 12l6.292 6.293a1 1 0 0 1 .083 1.32l-.083.094a1 1 0 0 1-1.32.083l-.094-.083L12 13.415l-6.293 6.292a1 1 0 0 1-1.414-1.414L10.585 12 4.293 5.707a1 1 0 0 1-.083-1.32l.083-.094-.083.094Z"
            fill="currentColor"
          />
        </svg>
      </IconButton>
    </div>
  );
};
