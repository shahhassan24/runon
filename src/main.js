const {
  app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeTheme, net, protocol, session, shell, systemPreferences,
} = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MEDIA_SCHEME = 'runon-media';
const ENTRY_FILENAME = /^\[[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}\]-\[(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\]\.md$/;
const VIDEO_EXTENSIONS = ['mp4', 'webm'];
const VIDEO_ENTRY_TEXT = 'Video Entry';
const WELCOME_MARKER = 'Welcome to Runon';
const CHAT_URLS = {
  chatgpt: 'https://chatgpt.com/?q=',
  claude: 'https://claude.ai/new?q=',
};
const IS_MAC = process.platform === 'darwin';
const PRIVACY_SETTINGS = IS_MAC
  ? {
    camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
    microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  }
  : {
    camera: 'ms-settings:privacy-webcam',
    microphone: 'ms-settings:privacy-microphone',
  };

protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true } },
]);

let mainWindow = null;
const recordings = new Map();

const dataDir = () => process.env.RUNON_DATA_DIR || path.join(app.getPath('documents'), 'Runon');
const videosDir = () => path.join(dataDir(), 'Videos');

function assertEntryFilename(filename) {
  if (typeof filename !== 'string' || !ENTRY_FILENAME.test(filename)) {
    throw new Error('Invalid entry filename');
  }
  return filename;
}

const entryBase = (filename) => filename.slice(0, -'.md'.length);
const entryPath = (filename) => path.join(dataDir(), assertEntryFilename(filename));
const videoDirectory = (filename) => path.join(videosDir(), entryBase(assertEntryFilename(filename)));

function writeAtomic(target, contents) {
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, contents);
  fs.renameSync(temp, target);
}

function findVideo(filename) {
  const directory = videoDirectory(filename);
  const base = entryBase(filename);
  for (const extension of VIDEO_EXTENSIONS) {
    const candidate = path.join(directory, `${base}.${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function previewOf(content) {
  const preview = content.replace(/\n/g, ' ').trim();
  return preview.length > 30 ? `${preview.slice(0, 30)}...` : preview;
}

function timestampOf(filename) {
  const [, year, month, day, hour, minute, second] = filename.match(ENTRY_FILENAME);
  return new Date(+year, +month - 1, +day, +hour, +minute, +second);
}

function describeEntry(filename, content) {
  const timestamp = timestampOf(filename);
  const video = findVideo(filename);
  return {
    filename,
    base: entryBase(filename),
    timestamp: timestamp.getTime(),
    displayDate: timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    type: video ? 'video' : 'text',
    previewText: video ? VIDEO_ENTRY_TEXT : previewOf(content),
    hasThumbnail: Boolean(video) && fs.existsSync(path.join(videoDirectory(filename), 'thumbnail.jpg')),
    isWelcome: content.includes(WELCOME_MARKER),
  };
}

function newFilename() {
  const pad = (value) => String(value).padStart(2, '0');
  const now = new Date();
  const stamp = [
    now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
    pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds()),
  ].join('-');
  return `[${crypto.randomUUID().toUpperCase()}]-[${stamp}].md`;
}

function saveEntry(filename, text) {
  if (typeof text !== 'string') throw new Error('Invalid entry text');
  writeAtomic(entryPath(filename), text);
  return previewOf(text);
}

function pdfTitle(content, displayDate) {
  const words = content
    .split(/\s+/)
    .map((word) => word.replace(/^[.,!?;:"'()[\]{}<>]+|[.,!?;:"'()[\]{}<>]+$/g, '').toLowerCase())
    .map((word) => word.replace(/[/\\:*?"<>|]/g, '-'))
    .filter(Boolean)
    .slice(0, 4);
  return words.length ? words.join('-') : `Entry ${displayDate}`;
}

async function exportPdf(_event, { filename, fontFamily, fontSize }) {
  const content = fs.readFileSync(entryPath(filename), 'utf8');
  const { displayDate } = describeEntry(filename, content);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${pdfTitle(content, displayDate)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { saved: false };

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await printWindow.loadFile(path.join(__dirname, 'renderer', 'print.html'));
    await printWindow.webContents.executeJavaScript(`
      (async () => {
        const page = document.getElementById('page');
        page.textContent = ${JSON.stringify(content.trim())};
        page.style.fontFamily = ${JSON.stringify(String(fontFamily))};
        page.style.fontSize = ${JSON.stringify(`${Number(fontSize) || 18}px`)};
        await document.fonts.ready;
      })()
    `);
    const pdf = await printWindow.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      margins: { top: 1, bottom: 1, left: 1, right: 1 },
    });
    fs.writeFileSync(filePath, pdf);
    return { saved: true, filePath };
  } finally {
    printWindow.destroy();
  }
}

async function requestMediaAccess() {
  const result = {};
  for (const type of ['camera', 'microphone']) {
    const status = systemPreferences.getMediaAccessStatus(type);
    if (IS_MAC) {
      result[type] = status === 'not-determined'
        ? await systemPreferences.askForMediaAccess(type)
        : status === 'granted';
    } else {
      // Windows has no app prompt here: access is on unless it was turned off in Settings.
      result[type] = status !== 'denied';
    }
  }
  return result;
}

function closeRecording(id, { removeFile }) {
  const recording = recordings.get(id);
  if (!recording) return null;
  recordings.delete(id);
  fs.closeSync(recording.fd);
  if (removeFile) fs.rmSync(recording.file, { force: true });
  return recording;
}

function finishRecording(_event, { id, extension, thumbnail, replaceFilename }) {
  if (!['mp4', 'webm'].includes(extension)) throw new Error('Invalid video format');
  const recording = closeRecording(id, { removeFile: false });
  if (!recording) throw new Error('Recording not found');

  const reuse = typeof replaceFilename === 'string'
    && ENTRY_FILENAME.test(replaceFilename)
    && fs.existsSync(entryPath(replaceFilename));
  const filename = reuse ? replaceFilename : newFilename();
  const directory = videoDirectory(filename);

  fs.mkdirSync(directory, { recursive: true });
  fs.renameSync(recording.file, path.join(directory, `${entryBase(filename)}.${extension}`));

  const prefix = 'data:image/jpeg;base64,';
  if (typeof thumbnail === 'string' && thumbnail.startsWith(prefix)) {
    fs.writeFileSync(path.join(directory, 'thumbnail.jpg'), Buffer.from(thumbnail.slice(prefix.length), 'base64'));
  }
  writeAtomic(entryPath(filename), VIDEO_ENTRY_TEXT);
  return describeEntry(filename, VIDEO_ENTRY_TEXT);
}

function registerIpc() {
  ipcMain.handle('entries:list', () => {
    const entries = fs.readdirSync(dataDir())
      .filter((name) => ENTRY_FILENAME.test(name))
      .map((name) => describeEntry(name, fs.readFileSync(entryPath(name), 'utf8')))
      .sort((a, b) => (b.timestamp - a.timestamp) || b.filename.localeCompare(a.filename));
    return { entries, folder: dataDir() };
  });

  ipcMain.handle('entries:create', (_event, { withWelcome }) => {
    const filename = newFilename();
    const text = withWelcome ? fs.readFileSync(path.join(__dirname, 'welcome.md'), 'utf8') : '';
    writeAtomic(entryPath(filename), text);
    return { entry: describeEntry(filename, text), text };
  });

  ipcMain.handle('entries:read', (_event, filename) => (
    fs.readFileSync(entryPath(filename), 'utf8').replace(/^\n+/, '')
  ));

  ipcMain.on('entries:saveSync', (event, filename, text) => {
    try {
      event.returnValue = saveEntry(filename, text);
    } catch (error) {
      console.error('Could not save entry:', error);
      event.returnValue = null;
    }
  });

  ipcMain.handle('entries:delete', async (_event, filename) => {
    const directory = videoDirectory(filename);
    if (fs.existsSync(directory)) await shell.trashItem(directory);
    await shell.trashItem(entryPath(filename));
  });

  ipcMain.handle('entries:exportPdf', exportPdf);
  ipcMain.handle('folder:open', () => shell.openPath(dataDir()));

  ipcMain.handle('chat:open', (_event, provider, text) => {
    if (!Object.hasOwn(CHAT_URLS, provider) || typeof text !== 'string') throw new Error('Invalid chat request');
    return shell.openExternal(CHAT_URLS[provider] + encodeURIComponent(text));
  });

  ipcMain.handle('clipboard:write', (_event, text) => clipboard.writeText(String(text)));
  ipcMain.handle('media:access', requestMediaAccess);

  ipcMain.handle('settings:openPrivacy', (_event, device) => {
    if (!Object.hasOwn(PRIVACY_SETTINGS, device)) throw new Error('Invalid settings pane');
    return shell.openExternal(PRIVACY_SETTINGS[device]);
  });

  ipcMain.handle('theme:set', (_event, theme) => {
    nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light';
  });

  ipcMain.handle('window:toggleFullscreen', () => {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });

  ipcMain.handle('video:begin', () => {
    const id = crypto.randomUUID();
    const file = path.join(videosDir(), `${id}.part`);
    recordings.set(id, { file, fd: fs.openSync(file, 'w') });
    return id;
  });

  ipcMain.handle('video:chunk', (_event, id, chunk) => {
    const recording = recordings.get(id);
    if (!recording) throw new Error('Recording not found');
    fs.writeSync(recording.fd, Buffer.from(chunk));
  });

  ipcMain.handle('video:abort', (_event, id) => {
    closeRecording(id, { removeFile: true });
  });

  ipcMain.handle('video:finish', finishRecording);
}

async function serveMedia(request) {
  const [base, kind] = decodeURIComponent(new URL(request.url).pathname.slice(1)).split('/');
  const filename = `${base}.md`;
  if (!ENTRY_FILENAME.test(filename)) return new Response(null, { status: 404 });

  const file = kind === 'thumbnail'
    ? path.join(videoDirectory(filename), 'thumbnail.jpg')
    : kind === 'video' && findVideo(filename);
  if (!file) return new Response(null, { status: 404 });

  const response = await net.fetch(pathToFileURL(file).toString(), { headers: request.headers });
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!range) return response;

  // Electron returns the requested bytes but labels them 200; video seeking needs a real 206.
  const { size } = fs.statSync(file);
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  return new Response(response.body, {
    status: 206,
    headers: {
      'Content-Type': response.headers.get('content-type'),
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

function configurePermissions() {
  const allowed = new Set(['media', 'local-fonts']);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => allowed.has(permission));
}

function buildMenu() {
  const newEntry = {
    label: 'New Entry',
    accelerator: 'CmdOrCtrl+N',
    click: () => mainWindow && mainWindow.webContents.send('menu:newEntry'),
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: IS_MAC ? [newEntry] : [newEntry, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
    ...(IS_MAC ? [{ role: 'windowMenu' }] : [{ label: 'Help', submenu: [{ role: 'about' }] }]),
  ]));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 600,
    minWidth: 1100,
    minHeight: 600,
    show: false,
    // Windows keeps its normal title bar so the minimize and close buttons stay put.
    ...(IS_MAC ? { titleBarStyle: 'hidden' } : { autoHideMenuBar: true }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('fullscreen', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('fullscreen', false));
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    fs.mkdirSync(videosDir(), { recursive: true });
    app.setAboutPanelOptions({ copyright: 'Built by Shah Hassan. Based on Freewrite by Farza Majeed.' });
    protocol.handle(MEDIA_SCHEME, serveMedia);
    configurePermissions();
    registerIpc();
    buildMenu();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('will-quit', () => {
    for (const id of [...recordings.keys()]) closeRecording(id, { removeFile: true });
  });
}
