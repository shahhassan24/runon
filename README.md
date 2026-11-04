<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/renderer/assets/runon-logo-light-ink.svg">
    <img src="src/renderer/assets/runon-logo-dark-ink.svg" alt="Runon" height="64">
  </picture>
</p>

<p align="center">
  <strong>A quiet place to write without stopping.</strong><br>
  A distraction-free freewriting app for macOS and Windows. Your words stay on your computer.
</p>

<p align="center">
  <img src="docs/screenshots/writing-light.png" alt="Runon's writing screen in light mode, with an entry in progress and a minimal bar along the bottom" width="800">
</p>

## Why Runon

Most of us edit while we write, and that gets in the way of finding out what we actually think.

Freewriting fixes that with one rule: keep writing for a set time, without going back. Spelling doesn't matter, and neither does whether it's any good. Once you've run through the polished first thoughts, the honest ones start to show up.

Runon is built around that rule. There are no folders, formatting tools, or accounts. You open it and start typing.

## How it works

1. Pick something to write about, like a decision, a problem at work, or a new idea.
2. Click **Fullscreen**.
3. Click the **timer**. The menu fades away, leaving only your words.
4. Keep writing until the menu fades back in.

Turn **Backspace off** if you want to make going back impossible.

## Features

- **Timer:** 15 minutes by default. Scroll over it to change the time in 5-minute steps, up to 45 minutes, and double-click to reset.
- **Backspace off:** blocks the Backspace and Delete keys so you keep moving forward.
- **Autosave:** there's no save button. New entries are ready to write in as soon as you click **New Entry**.
- **History:** browse past entries in the sidebar, export them as PDFs, or move them to the Trash.
- **Video entries:** record yourself talking instead of typing, then play it back in the app.
- **Chat, if you want it:** after a long session, send an entry to ChatGPT or Claude to talk it through.
- **Your look:** light and dark themes, several text sizes, and Lato, Arial, System, Serif, or a random font from your computer.

<p align="center">
  <img src="docs/screenshots/history-dark.png" alt="Runon in dark mode with the History sidebar open, listing past entries" width="800">
</p>

## Your privacy

Runon has no accounts, server, or analytics. Everything is saved as ordinary files you can open, back up, or move:

```text
Documents/Runon/
├── [id]-[date].md          one file per entry, in plain text
└── Videos/
    └── [id]-[date]/
        ├── [id]-[date].mp4
        └── thumbnail.jpg
```

A few things to know:

- **Chat is the one feature that sends your writing anywhere.** It only happens when you click it, and your entry is placed in a web link to ChatGPT or Claude, so it may also stay in your browser history. **Copy Prompt** lets you paste it yourself instead.
- **Files aren't encrypted.** Anyone with access to your user account can read them. Turn on FileVault or BitLocker to protect them if your computer is lost.
- **Cloud sync applies as usual.** If your `Documents` folder syncs to iCloud or OneDrive, your entries sync too.

## Install

Installers aren't published yet, so for now you'll need to [build Runon from source](#build-from-source).

| Platform | Requires | Status |
| --- | --- | --- |
| Mac with Intel | macOS 13 Ventura or newer | Tested on macOS 13 |
| Mac with Apple Silicon | macOS 13 Ventura or newer | Included in the Mac build, not yet tested |
| Windows (64-bit) | Windows 10 or newer | Builds, not yet tested |

The builds aren't signed with an Apple or Microsoft certificate, so a copy you download from someone else will trigger a warning the first time you open it:

- **macOS:** right-click the app and choose **Open**. If it's still blocked, allow it in **System Settings > Privacy & Security**.
- **Windows:** on the SmartScreen warning, click **More info**, then **Run anyway**.

The first time you record a video, your Mac asks for camera and microphone access. On Windows, these are controlled in **Settings > Privacy & security**.

## Build from source

You need [Node.js](https://nodejs.org) 22.

```bash
git clone https://github.com/shahhassan24/runon.git
```

```bash
cd runon
```

```bash
npm install
```

Run the app:

```bash
npm start
```

Build the installers. The results go in `dist/`:

```bash
npm run dist
```

| Command | What it does |
| --- | --- |
| `npm start` | Runs the app from source |
| `npm run dist` | Builds the Mac and Windows installers (run this on a Mac) |
| `npm run dist:mac` | Builds the universal Mac `.dmg` |
| `npm run dist:win` | Builds the Windows installer |
| `npm test` | Runs the end-to-end tests on a Mac, after `npm run dist:mac` |
| `npm run icon` | Regenerates the app icons from `build/icon.svg` |

The tests drive the packaged Mac app using a temporary folder and a simulated camera, so they don't touch your real entries or your webcam.

Electron is pinned to 45.2.2, which supports macOS 13. Before upgrading it, check that the new version still supports the macOS versions you need. The built app's minimum is listed under `LSMinimumSystemVersion` in its `Info.plist`.

## Project layout

```text
src/
├── main.js          Files, window, menus, permissions, PDF export
├── preload.js       The bridge between the page and main.js
├── welcome.md       The guide shown on first launch
└── renderer/        The interface: HTML, CSS, app.js, fonts, and logos
build/               App icons
test/e2e.js          End-to-end tests
tools/make-icon.js   Generates the app icons
```

Runon is plain JavaScript, HTML, and CSS, with no frontend framework or bundler. Electron is the only thing it needs to run.

## Known limitations

- Video entries have no transcripts, so Chat only works with written entries.
- There are no automatic updates. To update, install a newer build over the old one.
- Apple Silicon and Windows builds haven't been run on real hardware yet. If you try one, please [open an issue](https://github.com/shahhassan24/runon/issues) and say how it went.

## Credits

Built by **Lord Shady**.

Runon is an Electron rebuild of [Freewrite](https://github.com/farzaa/freewrite) by Farza Majeed, whose idea and design it's based on. The ChatGPT and Claude prompts also come from Freewrite.

## License

[MIT](LICENSE). The bundled Lato font is under the [SIL Open Font License](src/renderer/fonts/OFL.txt).
