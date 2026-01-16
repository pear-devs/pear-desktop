import { For } from 'solid-js';

export interface SelectProps {
  label: string;
  description: string;

  value: string;
  options: { label: string; value: string }[];
  onSelect: (value: string) => void;
}

export const Select = (props: SelectProps) => {
  return (
    <div
      style={{
        'display': 'flex',
        'align-items': 'flex-start',
        'justify-content': 'space-between',
        'gap': '24px',
        'margin-bottom': '20px',
      }}
    >
      <label
        style={{
          'flex': '0 0 160px',
          'text-align': 'right',
          'color': 'var(--mdui-color-on-surface)',
          'font-size': '0.95rem',
          'font-weight': 500,
          'line-height': '1.4',
          'padding-top': '0.5rem',
        }}
      >
        {props.label}
      </label>
      <div
        style={{
          'flex': 1,
          'display': 'flex',
          'flex-direction': 'column',
          'gap': '4px',
        }}
      >
        <span
          style={{
            'color': 'var(--mdui-color-on-surface-variant)',
            'font-size': '0.8rem',
            'line-height': '1.3',
          }}
        >
          {props.description}
        </span>
        <mdui-select style={{ width: '100%' }} value={props.value}>
          <For each={props.options}>
            {({ label, value }) => (
              <mdui-menu-item value={value}>{label}</mdui-menu-item>
            )}
          </For>
        </mdui-select>
      </div>
    </div>
  );
};
