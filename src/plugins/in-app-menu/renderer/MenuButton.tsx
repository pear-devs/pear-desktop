import { type JSX, splitProps } from 'solid-js';
import { css } from 'solid-styled-components';

import { cacheNoArgs } from '@/providers/decorators';

const menuStyle = cacheNoArgs(
  () => css`
    -webkit-app-region: none;

    display: flex;
    justify-content: center;
    align-items: center;
    align-self: stretch;

    padding: 2px 8px;
    border-radius: 4px;

    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);

    &:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }
    &:active {
      scale: 0.9;
    }

    &[data-selected='true'] {
      background-color: rgba(255, 255, 255, 0.2);
    }
  `,
);

export type MenuButtonProps = JSX.HTMLAttributes<HTMLLIElement> & {
  text?: string;
  selected?: boolean;
};
export const MenuButton = (props: MenuButtonProps) => {
  const [local, leftProps] = splitProps(props, ['text']);

  return (
    <li {...leftProps} class={menuStyle()} data-selected={props.selected}>
      {local.text}
    </li>
  );
};
