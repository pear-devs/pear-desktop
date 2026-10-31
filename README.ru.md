<div align="center">

# :pear: Pearum Desktop

[English](README.md) | **Русский**

[![Релиз GitHub](https://img.shields.io/github/release/maseckt/pearum-desktop.svg?style=for-the-badge)](https://github.com/maseckt/pearum-desktop/releases/)
[![Лицензия](https://img.shields.io/github/license/maseckt/pearum-desktop.svg?style=for-the-badge)](https://github.com/maseckt/pearum-desktop/blob/master/license)
[![Стиль кода Oxlint](https://img.shields.io/badge/code_style-Oxlint-5ed9c7.svg?style=for-the-badge)](https://github.com/maseckt/pearum-desktop/blob/dev/.oxlintrc.json)
[![Статус сборки](https://img.shields.io/github/actions/workflow/status/maseckt/pearum-desktop/build.yml?branch=master&style=for-the-badge)](https://github.com/maseckt/pearum-desktop/actions/workflows/build.yml)
[![Загрузки GitHub](https://img.shields.io/github/downloads/maseckt/pearum-desktop/total?style=for-the-badge)](https://github.com/maseckt/pearum-desktop/releases/)

</div>

Независимый форк [Pear Desktop](https://github.com/pear-devs/pear-desktop),
ориентированный на приватность, синхронизированные тексты песен и точечные улучшения стабильности с сохранением привычного интерфейса и системы плагинов.

Разработка ведётся в ветке [`dev`](https://github.com/maseckt/pearum-desktop/tree/dev).
Изменения из этой ветки могут ещё отсутствовать в опубликованных релизах.

> [!IMPORTANT]
> ⚠️ Отказ от ответственности
>
> **Отсутствие связи с правообладателями**
>
> Этот проект и его участники не связаны с Google LLC, YouTube, их дочерними компаниями или аффилированными лицами, не уполномочены ими и не получают их официального одобрения. **Это независимое, некоммерческое и неофициальное расширение, разрабатываемое командой добровольцев для использования сервиса в настольном приложении.**
>
> **Товарные знаки**
>
> Названия «Google» и «YouTube Music», а также связанные с ними знаки, эмблемы и изображения являются зарегистрированными товарными знаками Google LLC или соответствующих аффилированных лиц. Они используются исключительно для идентификации и справочных целей и не подразумевают связи с владельцами товарных знаков. Мы не намерены нарушать права правообладателей или причинять им вред.
>
> **Ограничение ответственности**
>
> Приложение (расширение) предоставляется «КАК ЕСТЬ» и используется на ваш страх и риск. Разработчики и участники проекта не несут ответственности за претензии, ущерб или иные последствия, включая юридические, возникающие в связи с использованием приложения. Ответственность за результаты его использования полностью лежит на пользователе.

## Содержание

- [Возможности](#возможности)
- [Перевод](#перевод)
- [Загрузка](#загрузка)
  - [Linux](#linux)
  - [macOS](#macos)
  - [Windows](#windows)
    - [Установка без подключения к сети в Windows](#установка-без-подключения-к-сети-в-windows)
- [Темы](#темы)
- [Разработка](#разработка)
- [Создание собственных плагинов](#создание-собственных-плагинов)
  - [Создание плагина](#создание-плагина)
  - [Типичные сценарии](#типичные-сценарии)
- [Сборка](#сборка)
  - [Сборка в devcontainer](#сборка-в-devcontainer)
- [Запуск production-сборки](#запуск-production-сборки)
- [Тесты](#тесты)
- [Лицензия](#лицензия)
- [Частые вопросы](#частые-вопросы)

## Возможности

- Нативная интеграция с рабочим столом и существующая система плагинов Pear Desktop.
- Улучшенные синхронизированные тексты песен: подбор кандидатов из нескольких источников, ограниченные по времени поиски, кеширование и стабильный выбор источника с оригинальными элементами управления.
- Экспериментальный «Плавающий текст» (Floating Lyrics): отдельное окно поверх остальных с изменяемым размером и управлением воспроизведением. Использует Synced Lyrics или штатный текст YouTube Music. По умолчанию отключён; поведение и внешний вид могут отличаться на разных платформах.
- Расширенные профили Do Not Track: Lite, Balanced, Strict и необязательные пользовательские списки фильтров.

В некоторых меню и названиях пакетов сохраняется брендинг исходного проекта.

## Перевод

Переводы исходного проекта поддерживаются на [Hosted Weblate](https://bit.ly/48n5YF7).
Изменения текстов, относящихся к этому форку, отправляйте в `src/i18n/resources/` этого репозитория.

<a href="https://bit.ly/48n5YF7">
  <img src="https://bit.ly/4q83L6S" alt="Статус перевода" />
  <img src="https://bit.ly/4h3zBxo" alt="Статус перевода 2" />
</a>

## Загрузка

Скачивайте Pearum Desktop только из [GitHub Releases этого проекта](https://github.com/maseckt/pearum-desktop/releases/).
Выберите файл для своей операционной системы и архитектуры устройства. Если сборки для вашей платформы нет, следуйте [инструкции по сборке](#сборка).

### Linux

Скачайте сборку для Linux из [GitHub Releases](https://github.com/maseckt/pearum-desktop/releases/), выбрав среди доступных файлов формат, который поддерживает ваш дистрибутив.

### macOS

Скачайте сборку для macOS под архитектуру своего устройства из [GitHub Releases](https://github.com/maseckt/pearum-desktop/releases/).

Если при ручной установке появляется ошибка «is damaged and can’t be opened», выполните в терминале:

```bash
/usr/bin/xattr -cr /Applications/Pear\ Desktop.app
```

### Windows

Скачайте установщик для Windows под архитектуру своего устройства из [GitHub Releases](https://github.com/maseckt/pearum-desktop/releases/) и запустите его.

*Примечание: Microsoft Defender SmartScreen может показать предупреждение о «неизвестном издателе».*

#### Установка без подключения к сети в Windows

- Скачайте файл `*.nsis.7z` для **архитектуры вашего устройства** со [страницы релизов этого форка](https://github.com/maseckt/pearum-desktop/releases/), если он доступен.
  - `x64` — для 64-битной Windows.
  - `ia32` — для 32-битной Windows.
  - `arm64` — для Windows ARM64.
- Скачайте установщик со страницы релиза (`*-Setup.exe`).
- Поместите оба файла в **один каталог**.
- Запустите установщик.

## Темы

Для изменения внешнего вида приложения можно загрузить CSS-файлы через меню Options > Visual Tweaks > Themes.

Готовые темы доступны в https://github.com/kerichdev/themes-for-ytmdesktop-player.

## Разработка

```bash
git clone --branch dev https://github.com/maseckt/pearum-desktop.git
cd pearum-desktop
pnpm install --frozen-lockfile
pnpm dev
```

Вместо установки pnpm в систему можно использовать [devcontainers](https://containers.dev/): как среду разработки в VS Code или для сборки проекта без установки зависимостей в основную систему.

У этого подхода есть ограничения: например, графический интерфейс не работает на некоторых Linux-хостах.

## Создание собственных плагинов

Плагины позволяют:

- управлять приложением: обработчику плагина передаётся `BrowserWindow` из Electron;
- изменять интерфейс через HTML/CSS.

### Создание плагина

Создайте каталог `src/plugins/YOUR-PLUGIN-NAME`:

- `index.ts` — основной файл плагина.

<details>
<summary>Пример плагина</summary>

```typescript
import style from './style.css?inline'; // import style as inline

import { createPlugin } from '@/utils';

export default createPlugin({
  name: 'Plugin Label',
  restartNeeded: true, // if value is true, ytmusic show restart dialog
  config: {
    enabled: false,
  }, // your custom config
  stylesheets: [style], // your custom style,
  menu: async ({ getConfig, setConfig }) => {
    // All *Config methods are wrapped Promise<T>
    const config = await getConfig();
    return [
      {
        label: 'menu',
        submenu: [1, 2, 3].map((value) => ({
          label: `value ${value}`,
          type: 'radio',
          checked: config.value === value,
          click() {
            setConfig({ value });
          },
        })),
      },
    ];
  },
  backend: {
    start({ window, ipc }) {
      window.maximize();

      // you can communicate with renderer plugin
      ipc.handle('some-event', () => {
        return 'hello';
      });
    },
    // it fired when config changed
    onConfigChange(newConfig) { /* ... */ },
    // it fired when plugin disabled
    stop(context) { /* ... */ },
  },
  renderer: {
    async start(context) {
      console.log(await context.ipc.invoke('some-event'));
    },
    // Only renderer available hook
    onPlayerApiReady(api, context) {
      // set plugin config easily
      context.setConfig({ myConfig: api.getVolume() });
    },
    onConfigChange(newConfig) { /* ... */ },
    stop(_context) { /* ... */ },
  },
  preload: {
    async start({ getConfig }) {
      const config = await getConfig();
    },
    onConfigChange(newConfig) {},
    stop(_context) {},
  },
});
```

</details>

### Типичные сценарии

- Добавление CSS: создайте `style.css` в том же каталоге, затем подключите его:

<details>
<summary>Пример подключения CSS</summary>

```typescript
// index.ts
import style from './style.css?inline'; // import style as inline

import { createPlugin } from '@/utils';

export default createPlugin({
  name: 'Plugin Label',
  restartNeeded: true, // if value is true, pear-desktop will show a restart dialog
  config: {
    enabled: false,
  }, // your custom config
  stylesheets: [style], // your custom style
  renderer() {} // define renderer hook
});
```

</details>

- Изменение HTML:

<details>
<summary>Пример изменения интерфейса</summary>

```typescript
import { createPlugin } from '@/utils';

export default createPlugin({
  name: 'Plugin Label',
  restartNeeded: true, // if value is true, ytmusic will show the restart dialog
  config: {
    enabled: false,
  }, // your custom config
  renderer() {
    console.log('hello from renderer');
  } // define renderer hook
});
```

</details>

- Обмен данными между интерфейсом и основной частью приложения возможен через модуль `ipcMain` из Electron. См. `index.ts` и пример плагина `sponsorblock`.

## Сборка

1. Клонируйте репозиторий.
2. Установите `pnpm` по [этой инструкции](https://pnpm.io/installation).
3. Выполните `pnpm install --frozen-lockfile` для установки зависимостей.
4. Выполните подходящую команду `pnpm dist:*` из списка ниже.

- `pnpm dist:win` — Windows.
- `pnpm dist:linux` — Linux (amd64).
- `pnpm dist:linux:deb-arm64` — Linux (arm64 для Debian).
- `pnpm dist:linux:rpm-arm64` — Linux (arm64 для Fedora).
- `pnpm dist:mac` — macOS (amd64).
- `pnpm dist:mac:arm64` — macOS (arm64).

Приложение собирается для macOS, Linux и Windows с помощью [electron-builder](https://github.com/electron-userland/electron-builder).

### Сборка в devcontainer

1. Клонируйте репозиторий.
2. Откройте каталог в VS Code.
3. При появлении предложения выберите повторное открытие в контейнере.
4. Выполните подходящую команду `pnpm dist:*` из списка выше.
5. Готовые пакеты находятся в каталоге `pack`; каталог `dist` содержит скомпилированное приложение.

Поскольку devcontainer монтирует рабочий каталог, собранные файлы также будут доступны в основной системе.

## Запуск production-сборки

```bash
pnpm start
```

## Тесты

```bash
pnpm test
```

Для тестирования приложения используется [Playwright](https://playwright.dev/).

Выполните `pnpm check` для проверки линтером, проверки форматирования и типов TypeScript.
Команда `pnpm audit` проверяет известные уязвимости зависимостей; обновления безопасности не означают полного отсутствия предупреждений в дереве зависимостей.

## Лицензия

MIT © [pear-devs](https://github.com/pear-devs/pear-desktop)

## Частые вопросы

### Почему не отображается меню приложения?

Если включена опция `Hide Menu`, меню можно показать клавишей <kbd>alt</kbd>
или <kbd>\`</kbd> (обратная кавычка), если используется плагин `in-app-menu`.
