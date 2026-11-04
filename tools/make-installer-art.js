// Renders the Mac and Windows installer art from build/dmg-statue.png. Run with: npm run installer-art
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '..', 'build');
const statue = `data:image/png;base64,${fs.readFileSync(path.join(buildDir, 'dmg-statue.png')).toString('base64')}`;

const MAC = { width: 720, height: 420 };
const macHtml = `<!doctype html><body style="margin:0;background:#000;overflow:hidden">
  <img src="${statue}" style="position:absolute;left:30px;bottom:0;height:1040px">
  <svg style="position:absolute;left:0;top:0" width="1440" height="840" viewBox="0 0 720 420" fill="none" stroke="#ECEBE4" stroke-opacity="0.75" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M436 200C462 190 486 190 512 200"/>
    <path d="M502 188 512 200 497 205"/>
  </svg>
</body>`;

// The Windows installer's side panel must be a 164x314 BMP.
const WINDOWS = { width: 164, height: 314 };
const windowsHtml = `<!doctype html><body style="margin:0;background:#000;overflow:hidden;text-align:center">
  <img src="${statue}" style="height:628px;display:block;margin:0 auto">
</body>`;

async function render(html, width, height) {
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    enableLargerThanScreen: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width, height });
  return image;
}

function toBmp24(image) {
  const { width, height } = image.getSize();
  const pixels = image.toBitmap(); // BGRA, top row first
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const headerSize = 54;
  const bmp = Buffer.alloc(headerSize + rowSize * height);
  bmp.write('BM');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(headerSize, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y += 1) {
    const target = headerSize + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x += 1) {
      pixels.copy(bmp, target + x * 3, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  return bmp;
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const mac = await render(macHtml, MAC.width * 2, MAC.height * 2);
  fs.writeFileSync(path.join(buildDir, 'background.png'), mac.resize({ width: MAC.width, height: MAC.height, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(buildDir, 'background@2x.png'), mac.resize({ width: MAC.width * 2, height: MAC.height * 2, quality: 'best' }).toPNG());

  const windows = await render(windowsHtml, WINDOWS.width * 2, WINDOWS.height * 2);
  const sidebar = windows.resize({ width: WINDOWS.width, height: WINDOWS.height, quality: 'best' });
  fs.writeFileSync(path.join(buildDir, 'installerSidebar.bmp'), toBmp24(sidebar));
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
