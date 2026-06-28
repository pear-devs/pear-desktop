import { type JSX } from 'solid-js';
import { css } from 'solid-styled-components';

import { cacheNoArgs } from '@/providers/decorators';

const iconButton = cacheNoArgs(
  () => css`
    -webkit-app-region: none;

    background: transparent;

    width: 24px;
    height: 24px;

    padding: 2px;
    border-radius: 2px;

    display: flex;
    justify-content: center;
    align-items: center;

    color: white;

    outline: none;
    border: none;

    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);

    &:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    &:active {
      scale: 0.9;
    }
  `,
);

type CollapseIconButtonProps = JSX.HTMLAttributes<HTMLButtonElement>;
export const IconButton = (props: CollapseIconButtonProps) => {
  return (
    <button {...props} class={iconButton()}>
      {props.children}
    </button>
  );
};
