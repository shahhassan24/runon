# Building Runon

How to create and install Runon on each platform. Finished files go in the `dist/` folder, which isn't uploaded to GitHub.

## Before you start

You need [Node.js](https://nodejs.org) 22 and the project's dependencies. Run these from the project folder.

If you use nvm, switch to Node 22:

```bash
nvm use 22
```

Install the dependencies. You only need to do this the first time, or after they change:

```bash
npm install
```

To number a new release, change `version` in `package.json` before you build. The version appears in the installer's filename.

## macOS

Run this on a Mac:

```bash
npm run dist:mac
```

| | |
| --- | --- |
| **Installer** | `dist/Runon-<version>-mac-universal.dmg` |
| **App** | `dist/mac-universal/Runon.app` |
| **Runs on** | macOS 13 Ventura or newer, on Intel and Apple Silicon |

**To install or update:**

1. Quit Runon if it's open.
2. Open the `.dmg`.
3. Drag **Runon** to **Applications**. If you're updating, choose **Replace**.

## Windows

Run this on a Mac:

```bash
npm run dist:win
```

We've only created this build on a Mac. The same command may work on a Windows PC, but that hasn't been tried.

| | |
| --- | --- |
| **Installer** | `dist/Runon-<version>-windows-setup.exe` |
| **App without installing** | `dist/win-unpacked/Runon.exe` |
| **Runs on** | Windows 10 or newer, 64-bit |

**To install or update:**

1. Quit Runon if it's open.
2. Copy the `.exe` to the Windows PC, run it, and follow the steps.

The Windows version hasn't been installed or run on a real PC yet, so test it before sharing it.

## Both at once

Run this on a Mac:

```bash
npm run dist
```

## Your entries are safe

Updating replaces only the app. Entries stay in `Documents/Runon`, and settings stay in place.

macOS may ask for camera and microphone access again after an update.

## Warnings when opening the app

These builds aren't signed with an Apple or Microsoft certificate, so people who download a copy may see a warning the first time they open it.

- **macOS:** right-click the app and choose **Open**. If it's still blocked, allow it in **System Settings > Privacy & Security**.
- **Windows:** on the SmartScreen warning, click **More info**, then **Run anyway**.

## Other platforms

Runon isn't set up to build for Linux.
