'use strict';

const api = window.runon;
const $ = (id) => document.getElementById(id);

const PLACEHOLDER = 'Begin anywhere. Don\u2019t stop.';
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
const SAVE_RETRY_DELAY = 2000;
const IDLE_AFTER = 5000;
const SUMMARY_TIME = 30000;
const SEARCH_DELAY = 150;
const ACTIVITY_LEVELS = [1, 100, 300, 700];
const ACTIVITY_WEEK_WIDTH = 10;
const THEME_FADE = 500;
const MIN_CHAT_LENGTH = 350;

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
  activeResult: 0,
  searchResults: [],
};

const editor = $('editor');
const nav = $('nav');
const randomOf = (items) => items[Math.floor(Math.random() * items.length)];

/* ---------- Saving ---------- */

function flushSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (!state.dirty || !state.selected) return;
  state.dirty = false;
  Object.assign(state.selected, api.saveEntry(state.selected.filename, editor.value));
  renderEntries();
}

function scheduleSave() {
  state.dirty = true;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, SAVE_DELAY);
}

/* ---------- Entries ---------- */

// Counts words across every entry written during a timed session.
function settleSession() {
  if (!state.session || !state.selected) return;
  state.session.words += state.selected.words - state.session.base;
  state.session.base = state.selected.words;
}

function beginSessionEntry() {
  if (state.session) state.session.base = state.selected.words;
}

async function selectEntry(entry) {
  flushSave();
  settleSession();
  state.selected = entry;
  beginSessionEntry();
  showText(await api.readEntry(entry.filename));
  renderEntryDate();
  closePopovers();
  renderEntries();
}

function showText(text) {
  editor.value = text;
  editor.placeholder = PLACEHOLDER;
  editor.setSelectionRange(text.length, text.length);
  editor.focus();
  editor.scrollTop = editor.scrollHeight;
}

async function createEntry() {
  flushSave();
  settleSession();
  const entry = await api.createEntry();
  state.entries.unshift(entry);
  state.selected = entry;
  beginSessionEntry();
  showText('');
  renderEntryDate();
  closePopovers();
  renderEntries();
}

async function deleteEntry(entry) {
  if (state.selected === entry) {
    clearTimeout(state.saveTimer);
    state.dirty = false;
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
  const emptyToday = entries.find((entry) => isToday(entry) && entry.previewText === '');

  if (!latest || !entries.some(isToday)) {
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

  const body = document.createElement('div');
  body.className = 'entry-body';
  const top = document.createElement('div');
  top.className = 'entry-top';
  const preview = document.createElement('div');
  preview.className = 'entry-preview';
  preview.textContent = entry.previewText || 'Empty entry';
  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  actions.append(actionButton(
    'export',
    'Export entry as PDF',
    '<path class="stroke" d="M8 2v8M4.5 7 8 10.5 11.5 7M3 14h10"/>',
    () => exportEntry(entry),
  ));
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

function activityTitle(date, words) {
  const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${words ? `${words} word${words === 1 ? '' : 's'}` : 'Nothing written'} on ${label}`;
}

function renderActivity() {
  const days = new Map();
  state.entries.forEach((entry) => {
    const key = new Date(entry.timestamp).toDateString();
    days.set(key, (days.get(key) || 0) + entry.words);
  });

  const today = new Date();
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 52 * 7 - today.getDay());
  const grid = document.createElement('div');
  grid.className = 'activity-grid';
  const months = document.createElement('div');
  months.className = 'activity-months';
  let daysWritten = 0;
  let week = 0;
  let labelledMonth = date.getDate() > 7 ? date.getMonth() : null;

  while (date <= today) {
    const words = days.get(date.toDateString()) || 0;
    const cell = document.createElement('div');
    cell.dataset.level = ACTIVITY_LEVELS.filter((minimum) => words >= minimum).length;
    cell.title = activityTitle(date, words);
    grid.append(cell);
    if (date >= new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()) && Number(cell.dataset.level) > 0) daysWritten += 1;
    if (date.getDay() === 0 && date.getMonth() !== labelledMonth) {
      labelledMonth = date.getMonth();
      const label = document.createElement('span');
      label.textContent = date.toLocaleDateString('en-US', { month: 'short' });
      label.style.left = `${week * ACTIVITY_WEEK_WIDTH}px`;
      months.append(label);
    }
    if (date.getDay() === 6) week += 1;
    date.setDate(date.getDate() + 1);
  }

  const scroller = $('activityScroller');
  const previous = scroller.scrollLeft;
  scroller.replaceChildren(months, grid);
  scroller.scrollLeft = previous || scroller.scrollWidth;
  $('activitySummary').textContent = `${daysWritten} day${daysWritten === 1 ? '' : 's'} written in the past year`;
}

function renderEntries() {
  if ($('sidebar').hidden) return;
  renderActivity();
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

function renderEntryDate() {
  const date = new Date(state.selected.timestamp);
  const part = (options) => date.toLocaleDateString('en-GB', options);
  $('entryDate').textContent = `${part({ weekday: 'long' })} ${part({ day: 'numeric' })} ${part({ month: 'long' })}`;
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
  $('themeLabel').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  localStorage.setItem('colorScheme', theme);
  api.setTheme(theme);
}

function toggleTheme() {
  const root = document.documentElement;
  root.classList.add('theme-fading');
  applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  clearTimeout(state.themeFadeTimer);
  state.themeFadeTimer = setTimeout(() => root.classList.remove('theme-fading'), THEME_FADE);
}

async function randomFonts() {
  if (!state.fontList) {
    const fonts = await api.listFonts();
    state.fontList = [...new Set(fonts)].filter((family) => !family.startsWith('.'));
  }
  return state.fontList;
}

function renderTimer() {
  const minutes = Math.floor(state.timeRemaining / 60);
  const seconds = String(state.timeRemaining % 60).padStart(2, '0');
  const time = `${minutes}:${seconds}`;
  $('timerBtn').textContent = time;
  $('timerValue').textContent = time;
  if (state.timerRunning && !state.timerClock) {
    state.timerClock = setInterval(tick, 1000);
  } else if (!state.timerRunning && state.timerClock) {
    clearInterval(state.timerClock);
    state.timerClock = null;
  }
  if (!state.timerRunning) $('runline').classList.remove('idle');
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
  $('topbar').classList.toggle('faded', !visible);
  editor.classList.toggle('nav-hidden', !visible);
}

function showSessionSummary() {
  flushSave();
  settleSession();
  const words = state.session ? state.session.words : 0;
  state.session = null;
  if (words <= 0) return;
  const minutes = Math.max(1, Math.round(state.timerTotal / 60));
  $('entryDate').textContent = `${words} word${words === 1 ? '' : 's'} in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  clearTimeout(state.summaryTimer);
  state.summaryTimer = setTimeout(renderEntryDate, SUMMARY_TIME);
}

function tick() {
  // Uses the real clock, because timers slow down while a window is hidden.
  state.timeRemaining = Math.max(0, Math.round((state.timerEndsAt - Date.now()) / 1000));
  if (state.timeRemaining === 0) {
    state.timerRunning = false;
    setNavVisible(true);
    $('runline').classList.add('finished');
    showSessionSummary();
  } else if (Date.now() - state.lastInput > IDLE_AFTER) {
    $('runline').classList.add('idle');
  }
  renderTimer();
}

function setTimerMinutes(minutes) {
  const clamped = Math.min(Math.max(minutes, MIN_TIMER_MINUTES), MAX_TIMER_MINUTES);
  state.timerTotal = clamped * 60;
  state.timeRemaining = state.timerTotal;
  state.timerEndsAt = Date.now() + state.timeRemaining * 1000;
  state.session = null;
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
    state.timerEndsAt = Date.now() + state.timeRemaining * 1000;
    if (state.timeRemaining === state.timerTotal || !state.session) {
      flushSave();
      state.session = { words: 0, base: state.selected.words };
    }
    state.lastInput = Date.now();
    clearTimeout(state.summaryTimer);
    renderEntryDate();
    closePopovers();
    setNavVisible(false);
    editor.focus();
  } else {
    setNavVisible(true);
  }
  renderTimer();
}

function resetTimer() {
  state.timerRunning = false;
  state.session = null;
  state.timeRemaining = state.timerTotal;
  $('runline').classList.remove('finished');
  setNavVisible(true);
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

  if (tooLong) {
    popover.replaceChildren(
      popoverText("Hey, your entry is quite long. Click Copy Prompt, then paste it into the AI of your choice. The prompt includes your entry."),
      copyButton(),
    );
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

/* ---------- Search ---------- */

function escapeForPattern(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightedSnippet(snippet, query) {
  const line = document.createElement('div');
  line.className = 'result-snippet';
  let position = 0;
  for (const match of snippet.matchAll(new RegExp(escapeForPattern(query), 'giu'))) {
    line.append(snippet.slice(position, match.index));
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    line.append(mark);
    position = match.index + match[0].length;
  }
  line.append(snippet.slice(position));
  return line;
}

async function openSearchResult(filename, query) {
  const entry = state.entries.find((candidate) => candidate.filename === filename);
  if (!entry) return;
  if (entry !== state.selected) await selectEntry(entry);
  const match = new RegExp(escapeForPattern(query), 'iu').exec(editor.value);
  if (!match) return;
  editor.setSelectionRange(match.index, match.index);
  editor.blur();
  editor.focus();
}

function setActiveResult(index) {
  const rows = [...document.querySelectorAll('.result')];
  if (!rows.length) return;
  state.activeResult = (index + rows.length) % rows.length;
  rows.forEach((row, position) => row.classList.toggle('active', position === state.activeResult));
  rows[state.activeResult].scrollIntoView({ block: 'nearest' });
}

function renderSearchResults(results, query) {
  const rows = results.map(({ filename, snippet }, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'result';
    row.tabIndex = -1;
    const entry = state.entries.find((candidate) => candidate.filename === filename);
    const date = document.createElement('div');
    date.className = 'entry-time';
    date.textContent = entry ? entry.displayDate : '';
    row.append(highlightedSnippet(snippet, query), date);
    row.addEventListener('mousemove', () => {
      if (state.activeResult !== index) setActiveResult(index);
    });
    row.addEventListener('click', () => chooseResult(filename, query));
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'result-empty';
    empty.textContent = 'No matches';
    rows.push(empty);
  }
  $('searchResults').replaceChildren(...rows);
  $('searchResults').hidden = false;
  setActiveResult(0);
}

async function runSearch() {
  const query = $('search').value.trim();
  state.searchQuery = query;
  if (!query) {
    $('searchResults').hidden = true;
    return;
  }
  flushSave();
  const results = await api.searchEntries(query);
  if (query === state.searchQuery) {
    state.searchResults = results;
    renderSearchResults(results, query);
  }
}

function openSearch() {
  if (!$('guide').hidden) return;
  closePopovers();
  $('spotlight').hidden = false;
  $('search').value = '';
  $('searchResults').hidden = true;
  state.searchQuery = '';
  $('search').focus();
}

function closeSearch() {
  clearTimeout(state.searchTimer);
  $('spotlight').hidden = true;
  editor.focus();
}

function chooseResult(filename, query) {
  closeSearch();
  return openSearchResult(filename, query);
}

function handleSearchKey(event) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeSearch();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    setActiveResult(state.activeResult + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const result = state.searchResults[state.activeResult];
    if (result && state.searchQuery && !$('searchResults').hidden) chooseResult(result.filename, state.searchQuery);
  }
}

/* ---------- Welcome guide ---------- */

function openGuide() {
  closePopovers();
  $('guide').hidden = false;
  $('guideClose').focus();
}

function closeGuide() {
  $('guide').hidden = true;
  localStorage.setItem('guideSeen', 'true');
  editor.focus();
}

/* ---------- Wiring ---------- */

function wireControls() {
  editor.addEventListener('input', () => {
    scheduleSave();
    state.lastInput = Date.now();
    $('runline').classList.remove('idle');
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
  $('themeBtn').addEventListener('click', toggleTheme);
  $('historyBtn').addEventListener('click', () => {
    $('sidebar').hidden = !$('sidebar').hidden;
    renderEntries();
    editor.focus();
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
    if (event.key !== 'Escape') return;
    closePopovers();
    if (!$('guide').hidden) closeGuide();
  });

  $('searchHint').textContent = api.platform === 'darwin' ? '⌘F' : 'Ctrl+F';
  $('searchBtn').addEventListener('click', openSearch);
  $('spotlight').addEventListener('mousedown', (event) => {
    if (event.target === $('spotlight')) closeSearch();
  });
  $('search').addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(runSearch, SEARCH_DELAY);
  });
  $('search').addEventListener('keydown', handleSearchKey);
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if ($('spotlight').hidden) openSearch();
      else closeSearch();
    }
  });
  $('guideBtn').addEventListener('click', openGuide);
  $('guideClose').addEventListener('click', closeGuide);

  api.onNewEntry(createEntry);
  api.onFullscreenChange((value) => {
    document.documentElement.classList.toggle('fullscreen', value);
    $('fullscreenLabel').textContent = value ? 'Exit Fullscreen' : 'Fullscreen';
  });

  window.addEventListener('pagehide', flushSave);
  window.addEventListener('runon-save-failed', () => {
    state.dirty = true;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flushSave, SAVE_RETRY_DELAY);
  });
}

document.documentElement.dataset.platform = api.platform;
applyTheme(localStorage.getItem('colorScheme') === 'dark' ? 'dark' : 'light');
applyFont();
renderTimer();
wireControls();
loadEntries()
  .then(() => {
    if (!localStorage.getItem('guideSeen')) openGuide();
  })
  .catch((error) => console.error('Could not load entries:', error));
