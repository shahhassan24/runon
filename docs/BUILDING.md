# Building Runon

How to create and install Runon on each platform. Runon is built with [Tauri](https://tauri.app).

## Before you start

You need:

- [Node.js](https://nodejs.org) 22
- [Rust](https://www.rust-lang.org/tools/install)
- **On a Mac:** the Xcode Command Line Tools (`xcode-select --install`)
- **On Windows:** the [Tauri prerequisites](https://tauri.app/start/prerequisites/)

Install the project's dependencies from the project folder. You only need to do this the first time, or after they change:

```bash
npm install
```

To number a new release, change `version` in both `package.json` and `src-tauri/tauri.conf.json` before you build.

The first build takes several minutes. Later builds are faster.

## macOS

Run this on a Mac:

```bash
npm run build
```

| | |
| --- | --- |
| **Installer** | `src-tauri/target/release/bundle/dmg/Runon_<version>_<chip>.dmg` |
| **Works on** | The same chip as the Mac that built it, on macOS 13 Ventura or newer |

A Mac only builds for its own chip by default. To get one installer that works on both Intel and Apple Silicon, use the GitHub workflow below.

**To install or update:**

1. Quit Runon if it's open.
2. Open the `.dmg`.
3. Drag **Runon** to **Applications**. If you're updating, choose **Replace**.

## Windows

Windows installers have to be built on Windows, or with the GitHub workflow below. On a Windows PC, run:

```bash
npm run build
```

| | |
| --- | --- |
| **Installer** | `src-tauri\target\release\bundle\nsis\Runon_<version>_x64-setup.exe` |
| **Works on** | Windows 10 or newer, 64-bit |

**To install or update:**

1. Quit Runon if it's open.
2. Run the `-setup.exe` and follow the steps.

The Windows version hasn't been run on a real PC yet, so test it before sharing it.

## Building on GitHub

This makes a Windows installer and a universal Mac installer without needing those machines:

1. Push your code to GitHub.
2. Open the repository's **Actions** tab and choose **Build installers**.
3. Click **Run workflow**.
4. When it finishes, download the installers from that run's **Artifacts** section.

The workflow hasn't been run yet, so check its first run.

## Testing

Run the full test suite on a Mac:

```bash
npm test
```

It runs the real app twice using a temporary folder. It doesn't touch your entries, settings, clipboard, browser, or Trash. It builds a separate test version first, so run `npm run build` again afterwards if you want an installer.

Run the native tests on their own, which works on any platform:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Your entries are safe

Updating replaces only the app. Entries stay in `Documents/Runon`.

## Warnings when opening the app

These builds aren't signed with an Apple or Microsoft certificate, so people who download a copy may see a warning the first time they open it.

- **macOS:** right-click the app and choose **Open**. If it's still blocked, allow it in **System Settings > Privacy & Security**.
- **Windows:** on the SmartScreen warning, click **More info**, then **Run anyway**.

## Changing the art

- **App icons:** run `npx tauri icon build/icon.png -o src-tauri/icons`.
- **Mac installer background:** replace `build/background.png` (720×420).
- **Windows installer panel:** replace `build/installerSidebar.bmp` (164×314, 24-bit BMP).

## Other platforms

Runon isn't set up to build for Linux.
