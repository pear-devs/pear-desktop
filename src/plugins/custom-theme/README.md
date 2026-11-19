# Custom Theme

A theme engine for `pear-desktop`. Themes are **self-contained folders** dropped
straight into this directory — no editing of plugin source is required.

## Built-in themes

| id               | colours         | layout                    |
| ---------------- | --------------- | ------------------------- |
| custom           | user-picked     | vanilla YT Music          |
| cli              | green-on-black  | flat, monospace, terminal |
| tokyo-night      | blue-on-navy    | vanilla + accent touches  |
| catppuccin-mocha | pastel lavender | vanilla + accent touches  |

On the `custom` theme the colours in **Colors ▸ …** apply as you pick them.
Selecting a built-in theme applies its own palette instead — the user colours
are ignored until you switch back to `custom`.

## Adding a new theme

Create a folder whose name is the id, add `index.ts` and `style.css`, done.
See [`_template/theme.md`](./_template/theme.md) for a full walkthrough and
a copy-paste starting point.

## How it works

`themes.ts` uses `import.meta.glob('./*/index.ts', { eager: true })` to
discover every subfolder with an `index.ts` at build time. Each file must
`export default` a `PearTheme` (from `./types`). The radio list in the menu
and the active-theme logic both read from this loader, so adding or removing a
folder is enough to register or deregister a theme.
