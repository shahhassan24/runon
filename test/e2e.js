// Drives the packaged app with a throwaway data folder and Chromium's fake camera.
// Usage: npm test -- [screenshot directory]
const { _electron: electron } = require('playwright-core');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const executablePath = path.join(__dirname, '..', 'dist', 'mac-universal', 'Runon.app', 'Contents', 'MacOS', 'Runon');
const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'runon-shots-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runon-data-'));
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runon-profile-'));
const pdfPath = path.join(dataDir, '..', `runon-test-${process.pid}.pdf`);
const results = [];
let page;
const clickMenu = async (selector) => {
  if (await page.$eval('#menu', (menu) => menu.hidden)) await page.click('#menuBtn');
  await page.click(selector);
};

async function launch() {
  const app = await electron.launch({
    executablePath,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--user-data-dir=${profileDir}`],
    env: { ...process.env, RUNON_DATA_DIR: dataDir },
  });
  await app.evaluate(({ dialog, ipcMain, shell }, target) => {
    globalThis.opened = [];
    shell.openExternal = async (url) => { globalThis.opened.push(url); };
    shell.trashItem = async (item) => process.getBuiltinModule('fs').rmSync(item, { recursive: true, force: true });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    ipcMain.removeHandler('media:access');
    ipcMain.handle('media:access', () => ({ camera: true, microphone: true }));
  }, pdfPath);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForSelector('#editor');
  await page.waitForFunction(() => document.getElementById('editor').placeholder !== '' || document.getElementById('editor').value !== '');
  return { app, page, errors };
}

async function step(name, action) {
  try {
    await action();
    results.push(`PASS ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${error.message.split('\n')[0]}`);
  }
}

const mdFiles = () => fs.readdirSync(dataDir).filter((name) => name.endsWith('.md'));
const newest = () => mdFiles().map((name) => path.join(dataDir, name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

(async () => {
  let app;
  let errors;
  ({ app, page, errors } = await launch());

  await step('first launch shows the welcome entry', async () => {
    assert.match(await page.inputValue('#editor'), /^Hi\. Welcome to Runon/);
    assert.strictEqual(mdFiles().length, 1);
    assert.strictEqual(await page.$eval('#editor', (el) => el.scrollTop), 0);
    assert.strictEqual(await page.$eval('html', (el) => el.dataset.theme), 'light');
    const profile = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    assert.ok(profile.startsWith(profileDir) || profile.includes('runon-profile-'), `isolated profile: ${profile}`);
  });
  await page.screenshot({ path: path.join(shots, '1-welcome.png') });

  await step('window title and About credit', async () => {
    assert.strictEqual(await app.evaluate(({ app: electronApp }) => electronApp.name), 'Runon');
    assert.strictEqual(await page.title(), 'Runon');
  });

  await step('new entry autosaves typing', async () => {
    await page.click('#newEntryBtn');
    assert.strictEqual(await page.inputValue('#editor'), '');
    await page.click('#editor');
    await page.keyboard.type('hello runon');
    await page.waitForTimeout(400);
    assert.strictEqual(fs.readFileSync(newest(), 'utf8'), 'hello runon');
  });

  await step('backspace toggle blocks deleting', async () => {
    await clickMenu('#backspaceBtn');
    assert.strictEqual(await page.textContent('#backspaceLabel'), 'Backspace is Off');
    await page.focus('#editor');
    await page.keyboard.press('Backspace');
    assert.strictEqual(await page.inputValue('#editor'), 'hello runon');
    await clickMenu('#backspaceBtn');
    await page.focus('#editor');
    await page.keyboard.press('Backspace');
    assert.strictEqual(await page.inputValue('#editor'), 'hello runo');
    await page.keyboard.type('n');
  });

  await step('font size and fonts apply', async () => {
    await page.click('#sizeBtn');
    assert.strictEqual(await page.textContent('#sizeBtn'), '20px');
    await page.click('[data-font="Serif"]');
    assert.match(await page.$eval('#editor', (el) => getComputedStyle(el).fontFamily), /Times New Roman/);
    await page.click('#randomBtn');
    await page.waitForFunction(() => document.getElementById('randomBtn').textContent.startsWith('Random ['));
    const installed = await page.evaluate(async () => (await window.queryLocalFonts()).length);
    results.push(`INFO installed fonts readable: ${installed}`);
    assert.ok(installed > 20, 'Random uses fonts from this Mac');
    await page.click('[data-font="Literata"]');
    assert.ok(await page.evaluate(() => document.fonts.check('18px Literata')));
  });

  await step('timer starts, fades the bar, scrolls, and resets', async () => {
    await page.hover('#timerBtn');
    await page.mouse.wheel(0, 100);
    assert.strictEqual(await page.textContent('#timerBtn'), '20:00');
    await page.mouse.wheel(0, -100);
    await page.click('#timerBtn');
    await page.click('[data-minutes="20"]');
    assert.strictEqual(await page.textContent('#timerValue'), '20:00');
    await page.click('#timerLess');
    assert.strictEqual(await page.textContent('#timerValue'), '19:00');
    await page.click('[data-minutes="15"]');
    await page.click('#timerStart');
    await page.waitForTimeout(1500);
    assert.match(await page.textContent('#timerBtn'), /^14:5\d$/);
    await page.mouse.move(500, 200);
    assert.ok(await page.$eval('#nav', (el) => el.classList.contains('faded')));
    assert.ok(await page.$eval('#runlineFill', (el) => el.getBoundingClientRect().width > 0), 'the line grows while the timer runs');
    assert.ok(await page.$eval('#editor', (el) => el.classList.contains('nav-hidden')));
    await page.hover('#timerBtn');
    assert.ok(!(await page.$eval('#nav', (el) => el.classList.contains('faded'))));
    await page.click('#timerBtn');
    await page.click('#timerReset');
    await page.mouse.click(500, 200);
    assert.strictEqual(await page.textContent('#timerBtn'), '15:00');
    await page.waitForTimeout(1100);
    assert.strictEqual(await page.$eval('#runlineFill', (el) => el.getBoundingClientRect().width), 0, 'reset empties the line');
  });

  await step('chat gates short text then opens the chosen AI', async () => {
    await clickMenu('#chatBtn');
    assert.match(await page.textContent('#chatPopover'), /minimum 5 minutes/);
    await clickMenu('#chatBtn');
    await page.fill('#editor', 'word '.repeat(90));
    await clickMenu('#chatBtn');
    await page.click('#chatPopover button:has-text("Claude")');
    const opened = await app.evaluate(() => globalThis.opened);
    assert.match(opened[0], /^https:\/\/claude\.ai\/new\?q=Take%20a%20look/);
    await clickMenu('#chatBtn');
    await page.click('#chatPopover button:has-text("Copy Prompt")');
    await page.waitForFunction(() => document.querySelector('#chatPopover').textContent.includes('Copied!'));
    assert.match(await app.evaluate(({ clipboard }) => clipboard.readText()), /my entry:\n\nword word/);
    await page.mouse.click(500, 200);
  });

  await step('very long entries fall back to copying', async () => {
    await page.fill('#editor', 'long '.repeat(2000));
    await clickMenu('#chatBtn');
    assert.match(await page.textContent('#chatPopover'), /quite long/);
    await page.mouse.click(500, 200);
    await page.fill('#editor', 'a real entry that exports to a pdf file\n\nsecond paragraph');
    await page.waitForTimeout(300);
  });

  await step('history lists entries and switching keeps text', async () => {
    await page.click('#historyBtn');
    assert.strictEqual(await page.locator('.entry').count(), 2);
    assert.match(await page.textContent('#credit'), /Built by Shah Hassan/);
    assert.strictEqual(await page.textContent('.day-label'), 'Today');
    await page.click('#randomBtn');
    await page.waitForFunction(() => document.getElementById('randomBtn').textContent.startsWith('Random ['));
    const bar = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#nav > *, #fontNav > *')].filter((el) => el.id !== 'fontNav' && !el.classList.contains('nav-spacer'));
      const boxes = items.map((el) => el.getBoundingClientRect()).sort((a, b) => a.left - b.left);
      return {
        fits: document.getElementById('nav').scrollWidth <= document.getElementById('nav').clientWidth,
        overlaps: boxes.filter((box, i) => i && box.left < boxes[i - 1].right - 0.5).length,
      };
    });
    assert.deepStrictEqual(bar, { fits: true, overlaps: 0 }, 'bottom bar fits with History open and a long font name');
    await page.click('[data-font="Literata"]');
    assert.ok(await page.$eval('.logo-dark-ink', (image) => image.complete && image.naturalWidth > 0 && image.offsetHeight > 0), 'dark-ink logo shows in light mode');
    await page.locator('.entry').nth(1).click();
    await page.waitForFunction(() => document.getElementById('editor').value.startsWith('Hi. Welcome'));
    await page.locator('.entry').nth(0).click();
    await page.waitForFunction(() => document.getElementById('editor').value.startsWith('a real entry'));
  });
  await page.screenshot({ path: path.join(shots, '2-history.png') });

  await step('PDF export writes a real PDF', async () => {
    await page.locator('.entry').nth(0).hover();
    await page.locator('.entry').nth(0).locator('.export').click();
    for (let i = 0; i < 50 && !fs.existsSync(pdfPath); i += 1) await page.waitForTimeout(100);
    const pdf = fs.readFileSync(pdfPath);
    assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.includes('Literata'), 'Literata should be embedded');
  });

  await step('dark theme applies and persists', async () => {
    await clickMenu('#themeBtn');
    assert.strictEqual(await page.$eval('#editor', (el) => getComputedStyle(document.body).backgroundColor), 'rgb(17, 17, 17)');
    assert.ok(await page.$eval('.logo-light-ink', (image) => image.complete && image.naturalWidth > 0 && image.offsetHeight > 0), 'light-ink logo shows in dark mode');
    assert.strictEqual(await page.$eval('.logo-dark-ink', (image) => image.offsetHeight), 0);
    assert.ok(await page.$eval('#sunIcon', (icon) => icon.getBoundingClientRect().width > 0), 'sun icon shows in dark mode');
    assert.strictEqual(await page.$eval('#moonIcon', (icon) => icon.getBoundingClientRect().width), 0);
  });
  await page.screenshot({ path: path.join(shots, '3-dark.png') });

  await step('fullscreen toggles', async () => {
    await clickMenu('#fullscreenBtn');
    await page.waitForFunction(() => document.getElementById('fullscreenLabel').textContent === 'Exit Fullscreen', null, { timeout: 8000 });
    await clickMenu('#fullscreenBtn');
    await page.waitForFunction(() => document.getElementById('fullscreenLabel').textContent === 'Fullscreen', null, { timeout: 8000 });
    await page.waitForTimeout(1000);
  });

  let videoFile;
  await step('recording saves a playable, seekable video entry', async () => {
    await page.click('#newEntryBtn');
    await clickMenu('#videoBtn');
    await page.waitForSelector('#recorder:not([hidden])');
    await page.waitForFunction(() => document.getElementById('preview').videoWidth > 0);
    await page.waitForTimeout(500);
    await page.click('#recorderToggle');
    await page.screenshot({ path: path.join(shots, '4-recording.png') });
    await page.waitForTimeout(4000);
    await page.click('#recorderToggle');
    await page.waitForSelector('#player:not([hidden])', { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('player').readyState >= 2, null, { timeout: 10000 });
    const [directory] = fs.readdirSync(path.join(dataDir, 'Videos'));
    const files = fs.readdirSync(path.join(dataDir, 'Videos', directory));
    videoFile = files.find((name) => /\.(mp4|webm)$/.test(name));
    assert.ok(videoFile, 'video file exists');
    const media = await app.evaluate(async ({ net }, base) => {
      const ask = (url, headers) => net.fetch(url, { headers }).then((response) => response.status).catch(() => 'blocked');
      const range = await net.fetch(`runon-media://entry/${encodeURIComponent(base)}/video`, { headers: { Range: 'bytes=10-19' } });
      return {
        rangeStatus: range.status,
        rangeHeader: range.headers.get('content-range'),
        rangeBytes: Buffer.from(await range.arrayBuffer()).toString('hex'),
        rangeType: range.headers.get('content-type'),
        traversal: await ask(`runon-media://entry/${encodeURIComponent('../../../../etc/hosts')}/video`),
      };
    }, directory);
    results.push(`INFO media ${JSON.stringify(media)}`);
    assert.strictEqual(media.rangeStatus, 206, 'long videos can seek');
    assert.strictEqual(media.rangeBytes, fs.readFileSync(path.join(dataDir, 'Videos', directory, videoFile)).subarray(10, 20).toString('hex'));
    assert.match(media.rangeHeader, /^bytes 10-19\/\d+$/);
    assert.strictEqual(media.traversal, 404);
    assert.ok(files.includes('thumbnail.jpg'), 'thumbnail exists');
    assert.strictEqual(fs.readFileSync(newest(), 'utf8'), 'Video Entry');
    assert.strictEqual(await page.locator('.entry').count(), 3, 'empty entry was reused');
    const info = await page.$eval('#player', async (video) => {
      video.muted = true;
      await video.play();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const audioBytes = video.webkitAudioDecodedByteCount;
      const videoBytes = video.webkitVideoDecodedByteCount;
      video.pause();
      if (!Number.isFinite(video.duration)) {
        video.currentTime = 1e9;
        await new Promise((resolve) => video.addEventListener('durationchange', resolve, { once: true }));
      }
      const { duration } = video;
      video.currentTime = duration / 2;
      await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
      return { duration, position: video.currentTime, width: video.videoWidth, audioBytes, videoBytes };
    });
    results.push(`INFO ${videoFile.split('.').pop()} ${JSON.stringify(info)}`);
    assert.ok(info.duration > 2 && info.duration < 8, `duration ${info.duration}`);
    assert.ok(info.position > 0.5, `seek ${info.position}`);
    assert.ok(info.audioBytes > 0, 'audio track decodes');
    assert.ok(info.videoBytes > 0, 'video track decodes');
    assert.ok(await page.$eval('.entry .thumb img', (image) => image.complete && image.naturalWidth > 0));
    const gap = await page.evaluate(() => document.getElementById('nav').getBoundingClientRect().top - document.getElementById('player').getBoundingClientRect().bottom);
    assert.ok(gap >= 0, 'bottom bar does not cover the player controls');
  });
  await page.screenshot({ path: path.join(shots, '5-video.png') });

  await step('closing the recorder discards the recording', async () => {
    const before = fs.readdirSync(path.join(dataDir, 'Videos')).length;
    await clickMenu('#videoBtn');
    await page.waitForSelector('#recorder:not([hidden])');
    await page.click('#recorderToggle');
    await page.waitForTimeout(1500);
    await page.click('#recorderClose');
    await page.waitForSelector('#recorder', { state: 'hidden' });
    assert.strictEqual(fs.readdirSync(path.join(dataDir, 'Videos')).length, before);
  });

  await step('deleting a video entry removes its files', async () => {
    await page.locator('.entry').nth(0).hover();
    await page.locator('.entry').nth(0).locator('.trash').click();
    await page.waitForFunction(() => document.querySelectorAll('.entry').length === 2);
    assert.strictEqual(fs.readdirSync(path.join(dataDir, 'Videos')).length, 0);
    assert.ok(await page.isVisible('#editor'));
  });

  await step('no renderer errors', async () => assert.strictEqual(errors.join(' | '), ''));

  await step('typing right before quitting is not lost', async () => {
    await page.click('#newEntryBtn');
    await page.focus('#editor');
    await page.keyboard.type('last words');
    await app.close();
    assert.strictEqual(fs.readFileSync(newest(), 'utf8'), 'last words');
  });

  await step('relaunch reopens saved entries and the theme', async () => {
    ({ app, page, errors } = await launch());
    await page.click('#historyBtn');
    assert.strictEqual(await page.locator('.entry').count(), 3);
    assert.strictEqual(await page.$eval('html', (el) => el.dataset.theme), 'dark');
  });
  await app.close();

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.rmSync(pdfPath, { force: true });
  console.log(results.join('\n'));
  console.log(`Screenshots: ${shots}`);
  process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
})().catch((error) => {
  console.log(results.join('\n'));
  console.error(error);
  process.exit(1);
});
