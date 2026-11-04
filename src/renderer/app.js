'use strict';

const api = window.runon;
const $ = (id) => document.getElementById(id);

const PLACEHOLDERS = [
  'Begin writing', 'Pick a thought and go', 'Start typing', "What's on your mind",
  'Just start', 'Type your first thought', 'Start with one sentence', 'Just say it',
];
const FONT_SIZES = [16, 18, 20, 22, 24, 26];
const FONT_STACKS = {
  Literata: '"Literata", Georgia, serif',
  Arial: 'Arial, sans-serif',
  System: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  Serif: '"Times New Roman", serif',
};
const MIN_TIMER_MINUTES = 1;
const MAX_TIMER_MINUTES = 120;
const savedTimerMinutes = Number(localStorage.getItem('timerMinutes'));
const DEFAULT_TIMER = (savedTimerMinutes >= MIN_TIMER_MINUTES && savedTimerMinutes <= MAX_TIMER_MINUTES ? savedTimerMinutes : 15) * 60;
const SCROLL_STEP = 40;
const MAX_CHAT_URL = 6000;
const SAVE_DELAY = 150;
const MIN_CHAT_LENGTH = 350;
const WELCOME_PREFIX = 'Hi. Welcome to Runon';

const state = {
  entries: [],
  selected: null,
  saveTimer: null,
  dirty: false,
  fontFamily: FONT_STACKS.Literata,
  fontKey: 'Literata',
  fontSize: 18,
  fontList: null,
  timeRemaining: DEFAULT_TIMER,
  timerTotal: DEFAULT_TIMER,
  timerRunning: false,
  scrollBuffer: 0,
  backspaceDisabled: false,
};

const editor = $('editor');
const player = $('player');
const nav = $('nav');
const isVideoSelected = () => state.selected !== null && state.selected.type === 'video';
const randomOf = (items) => items[Math.floor(Math.random() * items.length)];
const mediaUrl = (entry, kind) => `runon-media://entry/${encodeURIComponent(entry.base)}/${kind}`;

/* ---------- Saving ---------- */

function flushSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (!state.dirty || !state.selected || state.selected.type !== 'text') return;
  const preview = api.saveEntrySync(state.selected.filename, editor.value);
  if (preview === null) return; // Still dirty, so the next save or switch tries again.
  state.dirty = false;
  state.selected.previewText = preview;
  renderEntries();
}

function scheduleSave() {
  state.dirty = true;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, SAVE_DELAY);
}

/* ---------- Entries ---------- */

async function selectEntry(entry) {
  flushSave();
  state.selected = entry;
  if (entry.type === 'video') {
    editor.value = '';
    editor.hidden = true;
    player.hidden = false;
    player.src = mediaUrl(entry, 'video');
    player.play().catch(() => { /* the viewer can press play */ });
  } else {
    stopPlayer();
    editor.hidden = false;
    showText(await api.readEntry(entry.filename), entry.isWelcome);
  }
  updateModeControls();
  renderEntries();
}

// The welcome guide is read from the top; everything else continues from the end.
function showText(text, startAtTop) {
  editor.value = text;
  editor.placeholder = randomOf(PLACEHOLDERS);
  const caret = startAtTop ? 0 : text.length;
  editor.setSelectionRange(caret, caret);
  editor.focus();
  editor.scrollTop = startAtTop ? 0 : editor.scrollHeight;
}

function stopPlayer() {
  player.pause();
  player.removeAttribute('src');
  player.load();
  player.hidden = true;
}

async function createEntry() {
  flushSave();
  const { entry, text } = await api.createEntry({ withWelcome: state.entries.length === 0 });
  state.entries.unshift(entry);
  state.selected = entry;
  stopPlayer();
  editor.hidden = false;
  showText(text, entry.isWelcome);
  updateModeControls();
  renderEntries();
}

async function deleteEntry(entry) {
  if (state.selected === entry) {
    clearTimeout(state.saveTimer);
    state.dirty = false;
    stopPlayer();
  }
  await api.deleteEntry(entry.filename);
  state.entries = state.entries.filter((candidate) => candidate !== entry);
  if (state.selected === entry) {
    state.selected = null;
    if (state.entries.length) await selectEntry(state.entries[0]);
    else await createEntry();
  } else {
    renderEntries();
  }
}

async function exportEntry(entry) {
  if (state.selected === entry) flushSave();
  try {
    await api.exportPdf({ filename: entry.filename, fontFamily: state.fontFamily, fontSize: state.fontSize });
  } catch (error) {
    console.error('Could not export PDF:', error);
  }
}

const isToday = (entry) => new Date(entry.timestamp).toDateString() === new Date().toDateString();

async function loadEntries() {
  const { entries, folder } = await api.listEntries();
  state.entries = entries;
  $('historyPath').textContent = folder;

  const latest = entries[0];
  const onlyWelcome = entries.length === 1 && latest.isWelcome;
  const emptyToday = entries.find((entry) => isToday(entry) && entry.type === 'text' && entry.previewText === '');

  if (!latest || latest.type === 'video' || (!entries.some(isToday) && !onlyWelcome)) {
    await createEntry();
  } else {
    await selectEntry(emptyToday || latest);
  }
}

function icon(markup) {
  const template = document.createElement('template');
  template.innerHTML = `<svg viewBox="0 0 16 16" class="icon">${markup}</svg>`;
  return template.content.firstChild;
}

function actionButton(className, label, markup, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(icon(markup));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    action();
  });
  return button;
}

function dayLabel(entry) {
  const day = new Date(entry.timestamp).toDateString();
  if (day === new Date().toDateString()) return 'Today';
  if (day === new Date(Date.now() - 864e5).toDateString()) return 'Yesterday';
  return entry.displayDate;
}

function renderEntry(entry) {
  const row = document.createElement('div');
  row.className = `entry${entry === state.selected ? ' selected' : ''}`;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.addEventListener('click', () => {
    if (entry !== state.selected) selectEntry(entry);
  });
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target === row && entry !== state.selected) selectEntry(entry);
  });

  if (entry.type === 'video') {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (entry.hasThumbnail) {
      const image = document.createElement('img');
      image.src = mediaUrl(entry, 'thumbnail');
      image.alt = '';
      thumb.append(image);
    }
    thumb.append(icon('<path d="M4 2.5v11l9-5.5z"/>'));
    row.append(thumb);
  }

  const body = document.createElement('div');
  body.className = 'entry-body';
  const top = document.createElement('div');
  top.className = 'entry-top';
  const preview = document.createElement('div');
  preview.className = 'entry-preview';
  preview.textContent = entry.previewText || 'Empty entry';
  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  if (entry.type === 'text') {
    actions.append(actionButton(
      'export',
      'Export entry as PDF',
      '<path class="stroke" d="M8 2v8M4.5 7 8 10.5 11.5 7M3 14h10"/>',
      () => exportEntry(entry),
    ));
  }
  actions.append(actionButton(
    'trash',
    'Delete entry',
    '<path class="stroke" d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/>',
    () => deleteEntry(entry),
  ));
  top.append(preview, actions);
  const time = document.createElement('div');
  time.className = 'entry-time';
  time.textContent = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  body.append(top, time);
  row.append(body);
  return row;
}

function renderEntries() {
  if ($('sidebar').hidden) return;
  const groups = [];
  let currentLabel = null;
  state.entries.forEach((entry) => {
    const label = dayLabel(entry);
    if (label !== currentLabel) {
      currentLabel = label;
      const heading = document.createElement('div');
      heading.className = 'day-label';
      heading.textContent = label;
      const entries = document.createElement('div');
      entries.className = 'day-entries';
      groups.push(heading, entries);
    }
    groups[groups.length - 1].append(renderEntry(entry));
  });
  $('entryList').replaceChildren(...groups);
}

/* ---------- Controls ---------- */

function updateModeControls() {
  const video = isVideoSelected();
  $('fontNav').hidden = video;
  $('backspaceBtn').hidden = video;
  closePopovers();
}

function applyFont() {
  document.documentElement.style.setProperty('--editor-font', state.fontFamily);
  document.documentElement.style.setProperty('--editor-size', `${state.fontSize}px`);
  $('sizeBtn').textContent = `${state.fontSize}px`;
  document.querySelectorAll('.font-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.font === state.fontKey);
  });
  $('randomBtn').classList.toggle('active', state.fontKey === 'Random');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('moonIcon').toggleAttribute('hidden', theme === 'dark');
  $('sunIcon').toggleAttribute('hidden', theme !== 'dark');
  $('themeLabel').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  localStorage.setItem('colorScheme', theme);
  api.setTheme(theme);
}

async function randomFonts() {
  if (!state.fontList) {
    const fonts = await window.queryLocalFonts();
    state.fontList = [...new Set(fonts.map((font) => font.family))].filter((family) => !family.startsWith('.'));
  }
  return state.fontList;
}

function renderTimer() {
  const minutes = Math.floor(state.timeRemaining / 60);
  const seconds = String(state.timeRemaining % 60).padStart(2, '0');
  const time = `${minutes}:${seconds}`;
  $('timerBtn').textContent = time;
  $('timerValue').textContent = time;
  const elapsed = state.timerTotal - state.timeRemaining;
  $('runlineFill').style.width = `${(elapsed / state.timerTotal) * 100}%`;
  if (state.timerRunning) $('timerStart').textContent = 'Pause';
  else $('timerStart').textContent = elapsed > 0 && state.timeRemaining > 0 ? 'Resume' : 'Start';
  document.querySelectorAll('[data-minutes]').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.minutes) * 60 === state.timerTotal);
  });
}

function setNavVisible(visible) {
  nav.classList.toggle('faded', !visible);
  editor.classList.toggle('nav-hidden', !visible);
}

function tick() {
  if (!state.timerRunning) return;
  state.timeRemaining -= 1;
  if (state.timeRemaining === 0) {
    state.timerRunning = false;
    setNavVisible(true);
    $('runline').classList.add('finished');
  }
  renderTimer();
}

function setTimerMinutes(minutes) {
  const clamped = Math.min(Math.max(minutes, MIN_TIMER_MINUTES), MAX_TIMER_MINUTES);
  state.timerTotal = clamped * 60;
  state.timeRemaining = state.timerTotal;
  localStorage.setItem('timerMinutes', String(clamped));
  $('runline').classList.remove('finished');
  renderTimer();
}

function stepTimer(direction) {
  setTimerMinutes(Math.ceil(state.timeRemaining / 60) + direction);
}

function toggleTimer() {
  $('runline').classList.remove('finished');
  state.timerRunning = !state.timerRunning;
  if (state.timerRunning) {
    if (state.timeRemaining === 0) state.timeRemaining = state.timerTotal;
    closePopovers();
    setNavVisible(false);
    if (!isVideoSelected()) editor.focus();
  }
  renderTimer();
}

function resetTimer() {
  state.timerRunning = false;
  state.timeRemaining = state.timerTotal;
  $('runline').classList.remove('finished');
  renderTimer();
}

function handleTimerScroll(event) {
  event.preventDefault();
  state.scrollBuffer += event.deltaY;
  if (Math.abs(state.scrollBuffer) < SCROLL_STEP) return;
  const direction = state.scrollBuffer > 0 ? 5 : -5;
  state.scrollBuffer = 0;
  const minutes = Math.ceil(state.timeRemaining / 60) + direction;
  setTimerMinutes(Math.trunc(minutes / 5) * 5);
}

/* ---------- Popovers ---------- */

function closePopovers() {
  $('menu').hidden = true;
  $('timerPanel').hidden = true;
  $('chatPopover').hidden = true;
  $('videoPopover').hidden = true;
}

function popoverText(text) {
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  return paragraph;
}

function popoverButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function openChatPopover() {
  const popover = $('chatPopover');
  const text = editor.value.trim();
  const tooLong = Object.values(window.CHAT_PROMPTS).some((prompt) => (
    encodeURIComponent(`${prompt}\n\n${text}`).length > MAX_CHAT_URL
  ));
  const copyButton = () => {
    const button = popoverButton('Copy Prompt', async () => {
      await api.copyText(`${window.CHAT_PROMPTS.chatgpt}\n\n${text}`);
      button.textContent = 'Copied!';
    });
    return button;
  };
  const openIn = (provider) => () => {
    closePopovers();
    api.openChat(provider, `${window.CHAT_PROMPTS[provider]}\n\n${text}`);
  };

  if (isVideoSelected()) {
    popover.replaceChildren(popoverText('Chat works with written entries. Open or write one, then click this.'));
  } else if (tooLong) {
    popover.replaceChildren(
      popoverText("Hey, your entry is quite long. Click Copy Prompt, then paste it into the AI of your choice. The prompt includes your entry."),
      copyButton(),
    );
  } else if (text.startsWith(WELCOME_PREFIX)) {
    popover.replaceChildren(popoverText('That one is the welcome guide. Please write your own entry first.'));
  } else if (editor.value.length < MIN_CHAT_LENGTH) {
    popover.replaceChildren(popoverText('Please free write for at minimum 5 minutes first. Then click this. Trust.'));
  } else {
    popover.replaceChildren(
      popoverButton('ChatGPT', openIn('chatgpt')),
      popoverButton('Claude', openIn('claude')),
      copyButton(),
    );
  }
  popover.hidden = false;
}

function showPermissionPopover({ camera, microphone, message }) {
  const popover = $('videoPopover');
  const rows = [];
  if (message) rows.push(popoverText(message));
  const permissionRow = (text, label, pane) => {
    const button = popoverButton(text, () => {
      closePopovers();
      api.openPrivacySettings(pane);
    });
    const small = document.createElement('small');
    small.textContent = label;
    button.append(small);
    return button;
  };
  if (camera === false) rows.push(permissionRow('Hey, we need camera permission.', 'Open Camera Settings', 'camera'));
  if (microphone === false) rows.push(permissionRow('Hey, we need microphone permission.', 'Open Microphone Settings', 'microphone'));
  popover.replaceChildren(...rows);
  popover.hidden = false;
}

/* ---------- Video recording ---------- */

const recorder = {
  stream: null,
  mediaRecorder: null,
  id: null,
  extension: null,
  writes: Promise.resolve(),
  writeFailed: false,
  thumbnail: null,
  startedAt: 0,
  clock: null,
  preparing: false,
};

function chooseFormat() {
  const formats = [
    { mimeType: 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];
  return formats.find((format) => MediaRecorder.isTypeSupported(format.mimeType));
}

function setPreparing(preparing) {
  recorder.preparing = preparing;
  $('menuBtn').querySelector('.mark').toggleAttribute('hidden', preparing);
  $('menuBtn').querySelector('.spinner').hidden = !preparing;
}

async function openRecorder() {
  if (recorder.preparing || !$('recorder').hidden) return;
  closePopovers();
  setPreparing(true);
  try {
    const access = await api.requestMediaAccess();
    if (!access.camera || !access.microphone) {
      showPermissionPopover(access);
      return;
    }
    player.pause();
    recorder.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    $('preview').srcObject = recorder.stream;
    $('recorder').hidden = false;
    $('recorderToggle').textContent = 'Start Recording';
  } catch (error) {
    console.error('Could not open camera:', error);
    releaseCamera();
    showPermissionPopover({ message: 'Could not prepare camera right now. Please try again.' });
  } finally {
    setPreparing(false);
  }
}

function releaseCamera() {
  if (recorder.stream) recorder.stream.getTracks().forEach((track) => track.stop());
  recorder.stream = null;
  $('preview').srcObject = null;
}

function captureThumbnail() {
  const preview = $('preview');
  if (!preview.videoWidth) return null;
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 320 / preview.videoWidth);
  canvas.width = Math.round(preview.videoWidth * scale);
  canvas.height = Math.round(preview.videoHeight * scale);
  canvas.getContext('2d').drawImage(preview, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function renderRecordingTime() {
  const seconds = Math.floor((Date.now() - recorder.startedAt) / 1000);
  $('recorderTime').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function resetRecordingState() {
  clearInterval(recorder.clock);
  recorder.mediaRecorder = null;
  recorder.id = null;
  recorder.writes = Promise.resolve();
  recorder.writeFailed = false;
  recorder.thumbnail = null;
  $('recorderStatus').hidden = true;
  $('recorderToggle').textContent = 'Start Recording';
}

async function startRecording() {
  const format = chooseFormat();
  if (!format) throw new Error('This computer has no supported video format.');
  recorder.id = await api.beginRecording();
  recorder.extension = format.extension;
  recorder.thumbnail = captureThumbnail();

  const mediaRecorder = new MediaRecorder(recorder.stream, { mimeType: format.mimeType });
  const id = recorder.id;
  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (!event.data || event.data.size === 0) return;
    recorder.writes = recorder.writes
      .then(() => event.data.arrayBuffer())
      .then((buffer) => api.writeRecordingChunk(id, buffer))
      .catch((error) => {
        recorder.writeFailed = true;
        console.error('Could not write recording:', error);
      });
  });
  mediaRecorder.start(1000);
  recorder.mediaRecorder = mediaRecorder;
  recorder.startedAt = Date.now();
  $('recorderTime').textContent = '0:00';
  $('recorderStatus').hidden = false;
  $('recorderToggle').textContent = 'Stop Recording';
  recorder.clock = setInterval(renderRecordingTime, 500);
}

function stopMediaRecorder() {
  return new Promise((resolve) => {
    const { mediaRecorder } = recorder;
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      resolve();
      return;
    }
    mediaRecorder.addEventListener('stop', () => resolve(), { once: true });
    mediaRecorder.stop();
  });
}

async function finishRecording() {
  $('recorderToggle').textContent = 'Saving...';
  await stopMediaRecorder();
  await recorder.writes;

  const { id, extension, thumbnail, writeFailed } = recorder;
  if (writeFailed) {
    await api.abortRecording(id);
    throw new Error('The recording could not be written to disk.');
  }

  flushSave();
  const current = state.selected;
  const reuse = current && current.type === 'text' && editor.value.trim() === '';
  const entry = await api.finishRecording({
    id, extension, thumbnail, replaceFilename: reuse ? current.filename : null,
  });

  state.entries = state.entries.filter((candidate) => candidate.filename !== entry.filename);
  state.entries.unshift(entry);
  state.entries.sort((a, b) => (b.timestamp - a.timestamp) || b.filename.localeCompare(a.filename));
  closeRecorderView();
  await selectEntry(entry);
}

function closeRecorderView() {
  resetRecordingState();
  releaseCamera();
  $('recorder').hidden = true;
}

async function cancelRecorder() {
  const { id } = recorder;
  if (id) {
    await stopMediaRecorder();
    await recorder.writes;
    await api.abortRecording(id);
  }
  closeRecorderView();
  if (isVideoSelected()) player.play().catch(() => { /* the viewer can press play */ });
}

async function toggleRecording() {
  const button = $('recorderToggle');
  if (button.textContent === 'Saving...') return;
  try {
    if (recorder.mediaRecorder) await finishRecording();
    else await startRecording();
  } catch (error) {
    console.error('Recording failed:', error);
    closeRecorderView();
    showPermissionPopover({ message: 'Could not save that recording. Please try again.' });
  }
}

/* ---------- Wiring ---------- */

function wireControls() {
  editor.addEventListener('input', () => {
    scheduleSave();
    if (state.timerRunning) setNavVisible(false);
  });
  editor.addEventListener('keydown', (event) => {
    if (state.backspaceDisabled && (event.key === 'Backspace' || event.key === 'Delete')) {
      event.preventDefault();
    }
  });

  $('sizeBtn').addEventListener('click', () => {
    const index = FONT_SIZES.indexOf(state.fontSize);
    state.fontSize = FONT_SIZES[(index + 1) % FONT_SIZES.length];
    applyFont();
  });

  document.querySelectorAll('.font-btn').forEach((button) => {
    button.addEventListener('click', () => {
      state.fontFamily = FONT_STACKS[button.dataset.font];
      state.fontKey = button.dataset.font;
      $('randomBtn').textContent = 'Random';
      applyFont();
    });
  });

  $('randomBtn').addEventListener('click', async () => {
    const family = randomOf(await randomFonts());
    state.fontFamily = `${JSON.stringify(family)}, sans-serif`;
    state.fontKey = 'Random';
    $('randomBtn').textContent = `Random [${family}]`;
    applyFont();
  });

  $('timerBtn').addEventListener('click', () => {
    const opening = $('timerPanel').hidden;
    closePopovers();
    $('timerPanel').hidden = !opening;
    if (opening) $('timerStart').focus();
  });
  $('timerStart').addEventListener('click', toggleTimer);
  $('timerReset').addEventListener('click', resetTimer);
  $('timerLess').addEventListener('click', () => stepTimer(-1));
  $('timerMore').addEventListener('click', () => stepTimer(1));
  document.querySelectorAll('[data-minutes]').forEach((button) => {
    button.addEventListener('click', () => setTimerMinutes(Number(button.dataset.minutes)));
  });
  $('timerBtn').addEventListener('wheel', handleTimerScroll, { passive: false });
  $('videoBtn').addEventListener('click', openRecorder);
  $('chatBtn').addEventListener('click', () => {
    if ($('chatPopover').hidden) {
      closePopovers();
      openChatPopover();
    } else {
      closePopovers();
    }
  });
  $('backspaceBtn').addEventListener('click', () => {
    state.backspaceDisabled = !state.backspaceDisabled;
    $('backspaceLabel').textContent = state.backspaceDisabled ? 'Backspace is Off' : 'Backspace is On';
    editor.focus();
  });
  $('fullscreenBtn').addEventListener('click', () => {
    closePopovers();
    api.toggleFullscreen();
  });
  $('newEntryBtn').addEventListener('click', createEntry);
  $('menuBtn').addEventListener('click', () => {
    const opening = $('menu').hidden;
    closePopovers();
    $('menu').hidden = !opening;
  });
  $('themeBtn').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  $('historyBtn').addEventListener('click', () => {
    $('sidebar').hidden = !$('sidebar').hidden;
    renderEntries();
    if (!isVideoSelected()) editor.focus();
  });
  $('historyHeader').addEventListener('click', () => api.openFolder());

  nav.addEventListener('mouseenter', () => setNavVisible(true));
  nav.addEventListener('mouseleave', () => {
    if (state.timerRunning) setNavVisible(false);
  });

  document.addEventListener('mousedown', (event) => {
    if (!event.target.closest('.anchor')) closePopovers();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePopovers();
  });

  $('recorderToggle').addEventListener('click', toggleRecording);
  $('recorderClose').addEventListener('click', cancelRecorder);

  const savedVolume = Number(localStorage.getItem('videoVolume'));
  if (localStorage.getItem('videoVolume') !== null && savedVolume >= 0 && savedVolume <= 1) player.volume = savedVolume;
  player.addEventListener('volumechange', () => localStorage.setItem('videoVolume', String(player.volume)));

  api.onNewEntry(createEntry);
  api.onFullscreenChange((value) => {
    $('fullscreenLabel').textContent = value ? 'Exit Fullscreen' : 'Fullscreen';
  });

  window.addEventListener('pagehide', flushSave);
  setInterval(tick, 1000);
}

document.documentElement.dataset.platform = api.platform;
applyTheme(localStorage.getItem('colorScheme') === 'dark' ? 'dark' : 'light');
applyFont();
renderTimer();
wireControls();
loadEntries().catch((error) => console.error('Could not load entries:', error));
