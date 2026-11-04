// Renders build/icon.svg into build/icon.icns. Run with: npm run icon
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SIZE = 1024;
const buildDir = path.join(__dirname, '..', 'build');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    enableLargerThanScreen: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const svg = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf8');
  const html = `<!doctype html><body style="margin:0;background:transparent">${svg}</body>`;
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });

  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'runon-')) + '.iconset';
  fs.mkdirSync(iconset);
  for (const base of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(iconset, `icon_${base}x${base}.png`), image.resize({ width: base, quality: 'best' }).toPNG());
    fs.writeFileSync(path.join(iconset, `icon_${base}x${base}@2x.png`), image.resize({ width: base * 2, quality: 'best' }).toPNG());
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(buildDir, 'icon.icns')]);
  fs.writeFileSync(path.join(buildDir, 'icon.png'), image.toPNG());
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
