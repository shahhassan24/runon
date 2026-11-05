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
const THEME_FADE = 500;
const MIN_CHAT_LENGTH = 350;
const PLUS_OUTLINE = '<path class="stroke" d="M8 3v10M3 8h10"/>';
const TRASH_OUTLINE ='<path class="stroke" d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/>';
const FOLDER_OUTLINE = '<path class="stroke" d="M2 4.500V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.500 3.500H3a1 1 0 0 0-1 1z"/>';

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
  folders: [],
  openFolder: null,
  renamingFolder: null,
  confirmingDelete: null,
  folderNotice: null,
  dragged: null,
  moving: null,
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
  refreshEntry(state.selected);
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
  const entry = await api.createEntry($('sidebar').hidden ? null : state.openFolder);
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
  const { entries, folders, folder } = await api.listEntries();
  state.entries = entries;
  state.folders = sortedFolders(folders);
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

function entryCaption(entry) {
  const label = dayLabel(entry);
  if (label !== 'Today') return label;
  return new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// After a save only the words change, so the tile is updated in place instead of redrawing History.
function refreshEntry(entry) {
  if ($('sidebar').hidden) return;
  const row = [...document.querySelectorAll('#entryList .entry')].find((tile) => tile.dataset.filename === entry.filename);
  if (!row) return;
  row.querySelector('.entry-preview').textContent = entry.previewText || 'Empty entry';
  row.querySelector('.entry-page-text').textContent = entry.thumbText || '';
}

// Shown like a file in Finder: a page with the start of the writing on it, and its name below.
function renderEntry(entry) {
  const row = document.createElement('div');
  row.className = `entry${entry === state.selected ? ' selected' : ''}`;
  row.dataset.filename = entry.filename;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.title = `${entry.previewText || 'Empty entry'}\n${new Date(entry.timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })}`;
  startDrag(row, 'application/x-runon-entry', entry.filename, { entry });
  row.addEventListener('click', () => {
    if (entry !== state.selected) selectEntry(entry);
  });
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target === row && entry !== state.selected) selectEntry(entry);
  });

  const page = document.createElement('div');
  page.className = 'entry-page';
  const pageText = document.createElement('div');
  pageText.className = 'entry-page-text';
  pageText.textContent = entry.thumbText || '';
  page.append(pageText);

  const preview = document.createElement('div');
  preview.className = 'entry-preview';
  preview.textContent = entry.previewText || 'Empty entry';
  const time = document.createElement('div');
  time.className = 'entry-time';
  time.textContent = entryCaption(entry);

  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  const moveButton = actionButton(
    'move',
    'Move to folder',
    FOLDER_OUTLINE,
    () => openMoveMenu(entry, moveButton),
  );
  actions.append(
    moveButton,
    actionButton('export', 'Export entry as PDF', '<path class="stroke" d="M8 2v8M4.5 7 8 10.5 11.5 7M3 14h10"/>', () => exportEntry(entry)),
    actionButton('trash', 'Delete entry', TRASH_OUTLINE, () => deleteEntry(entry)),
  );
  row.append(actions, page, preview, time);
  return row;
}

/* ---------- Folders ---------- */

// A folder is known by its path from the top, like "Work/Ideas". null is the top itself.
const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null);
const leafOf = (path) => path.slice(path.lastIndexOf('/') + 1);
const joinPath = (parent, name) => (parent === null ? name : `${parent}/${name}`);
const isWithin = (path, ancestor) => path === ancestor || path.startsWith(`${ancestor}/`);
const repath = (path, from, to) => (path !== null && isWithin(path, from) ? to + path.slice(from.length) : path);
const childFolders = (parent) => state.folders.filter((path) => parentOf(path) === parent);
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const FOLDER_PLUS = '<path class="stroke" d="M2 4.500V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.500 3.500H3a1 1 0 0 0-1 1zM8 7v4M6 9h4"/>';

function sortedFolders(paths) {
  return [...paths].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
}

function folderIcon() {
  const template = document.createElement('template');
  template.innerHTML = `<svg viewBox="0 0 64 52" class="folder-icon" aria-hidden="true">
    <defs><linearGradient id="folderFront" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#84cdfa"/><stop offset="1" stop-color="#4fa9ee"/>
    </linearGradient></defs>
    <path fill="#3f97e0" d="M4 9a5 5 0 0 1 5-5h13.600c1.500 0 2.900.6 4 1.700L30 9h25a5 5 0 0 1 5 5v28a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/>
    <path fill="url(#folderFront)" d="M4 20a5 5 0 0 1 5-5h46a5 5 0 0 1 5 5v22a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/>
    <path fill="none" stroke="#fff" stroke-opacity=".45" d="M9 15.600h46"/>
  </svg>`;
  return template.content.firstChild;
}

function showFolder(path) {
  closePopovers();
  state.openFolder = path;
  state.confirmingDelete = null;
  state.folderNotice = null;
  renderEntries();
  $('entryList').scrollTop = 0;
}

// Keeps every remembered path right after a folder moves or is renamed.
function folderMoved(from, to) {
  state.folders = sortedFolders(state.folders.map((path) => repath(path, from, to)));
  state.entries.forEach((entry) => { entry.folder = repath(entry.folder, from, to); });
  state.openFolder = repath(state.openFolder, from, to);
}

async function moveEntry(entry, folder) {
  if (entry.folder === folder) return;
  try {
    await api.moveEntry(entry.filename, folder);
    entry.folder = folder;
    renderEntries();
  } catch (error) {
    console.error('Could not move entry:', error);
  }
}

async function moveFolder(path, into) {
  if (into !== null && isWithin(into, path)) return;
  if (parentOf(path) === into) return;
  try {
    await api.moveFolder(path, into);
    folderMoved(path, joinPath(into, leafOf(path)));
    renderEntries();
  } catch (error) {
    console.error('Could not move folder:', error);
  }
}

async function makeFolder(parent) {
  flushSave();
  const taken = new Set(childFolders(parent).map((path) => leafOf(path).toLowerCase()));
  let name = 'New Folder';
  for (let number = 2; taken.has(name.toLowerCase()); number += 1) name = `New Folder ${number}`;
  const path = joinPath(parent, name);
  await api.createFolder(path);
  state.folders = sortedFolders([...state.folders, path]);
  return path;
}

function startRenaming(path) {
  flushSave();
  state.renamingFolder = path;
  renderEntries();
}

async function addFolder() {
  try {
    startRenaming(await makeFolder(state.openFolder));
  } catch (error) {
    console.error('Could not create folder:', error);
  }
}

async function renameFolder(path, newName) {
  await api.renameFolder(path, newName);
  folderMoved(path, joinPath(parentOf(path), newName));
}

// Entries anywhere inside a deleted folder move up into the folder that held it.
async function deleteFolder(path) {
  const parent = parentOf(path);
  state.confirmingDelete = null;
  try {
    await api.deleteFolder(path);
    state.folders = state.folders.filter((folder) => !isWithin(folder, path));
    state.entries.forEach((entry) => {
      if (entry.folder !== null && isWithin(entry.folder, path)) entry.folder = parent;
    });
    showFolder(parent);
  } catch (error) {
    state.folderNotice = String(error);
    renderEntries();
  }
}

function askToDelete(path) {
  state.confirmingDelete = path;
  state.folderNotice = null;
  renderEntries();
}

function renderDeleteConfirm(path) {
  const parent = parentOf(path);
  const box = document.createElement('div');
  box.className = 'folder-confirm';
  const text = document.createElement('p');
  text.textContent = `Delete \u201c${leafOf(path)}\u201d? Everything written in it moves to ${parent === null ? 'History' : `\u201c${leafOf(parent)}\u201d`}.`;
  const cancel = popoverButton('Cancel', () => {
    state.confirmingDelete = null;
    renderEntries();
  });
  const remove = popoverButton('Delete Folder', () => deleteFolder(path));
  remove.className = 'danger';
  const buttons = document.createElement('div');
  buttons.className = 'folder-confirm-buttons';
  buttons.append(cancel, remove);
  box.append(text, buttons);
  return box;
}

function folderNameInput(path) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'folder-input';
  input.value = leafOf(path);
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Folder name');
  let finished = false;
  const finish = async (save, leaving = false) => {
    if (finished) return;
    finished = true;
    const newName = input.value.trim();
    if (save && newName && newName !== leafOf(path)) {
      try {
        await renameFolder(path, newName);
      } catch (error) {
        // Clicking away keeps the old name. Enter stays open so the name can be fixed.
        finished = false;
        if (leaving) {
          finish(false);
          return;
        }
        input.title = String(error);
        input.classList.add('invalid');
        input.focus();
        input.select();
        return;
      }
    }
    state.renamingFolder = null;
    renderEntries();
    editor.focus();
  };
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('blur', () => finish(true, true));
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') finish(true);
    else if (event.key === 'Escape') finish(false);
  });
  return input;
}

const DRAG_TYPES = ['application/x-runon-entry', 'application/x-runon-folder'];

function canDropInto(target) {
  const dragged = state.dragged;
  if (!dragged) return false;
  if (dragged.entry) return dragged.entry.folder !== target;
  return parentOf(dragged.folder) !== target && !(target !== null && isWithin(target, dragged.folder));
}

// Lets entries and folders be dropped here. null means the top of History.
function acceptDrops(element, target) {
  const ours = (event) => [...event.dataTransfer.types].some((type) => DRAG_TYPES.includes(type));
  element.addEventListener('dragover', (event) => {
    if (!ours(event) || !canDropInto(target)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    element.classList.add('drop-target');
  });
  element.addEventListener('dragleave', () => element.classList.remove('drop-target'));
  element.addEventListener('drop', (event) => {
    event.preventDefault();
    element.classList.remove('drop-target');
    const dragged = state.dragged;
    const allowed = canDropInto(target);
    state.dragged = null;
    if (!dragged || !allowed) return;
    if (dragged.entry) moveEntry(dragged.entry, target);
    else moveFolder(dragged.folder, target);
  });
}

function startDrag(element, type, value, dragged) {
  element.draggable = true;
  element.addEventListener('dragstart', (event) => {
    event.stopPropagation();
    // A private type, so dropping on the page can't paste anything into the writing.
    event.dataTransfer.setData(type, value);
    event.dataTransfer.effectAllowed = 'move';
    state.dragged = dragged;
    closePopovers();
    element.classList.add('dragging');
  });
  element.addEventListener('dragend', () => {
    state.dragged = null;
    element.classList.remove('dragging');
  });
}

function folderLabel(name) {
  const label = document.createElement('div');
  label.className = 'folder-name';
  label.textContent = name;
  return label;
}

function renderFolder(path) {
  const tile = document.createElement('div');
  tile.className = 'folder';
  tile.append(folderIcon());
  if (state.renamingFolder === path) {
    tile.append(folderNameInput(path));
    return tile;
  }
  const folders = childFolders(path).length;
  const entries = state.entries.filter((entry) => entry.folder === path).length;
  tile.title = `${leafOf(path)}: ${folders ? `${plural(folders, 'folder', 'folders')}, ` : ''}${plural(entries, 'entry', 'entries')}`;
  tile.tabIndex = 0;
  tile.setAttribute('role', 'button');
  tile.append(folderLabel(leafOf(path)));
  tile.addEventListener('click', () => showFolder(path));
  tile.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') showFolder(path);
  });
  startDrag(tile, 'application/x-runon-folder', path, { folder: path });
  acceptDrops(tile, path);
  return tile;
}

function renderToolbar() {
  const head = document.createElement('div');
  head.className = 'folders-head';
  const heading = document.createElement('div');
  heading.className = 'day-label';
  const loose = state.entries.filter((entry) => entry.folder === null).length;
  heading.textContent = `${plural(childFolders(null).length, 'folder', 'folders')}, ${plural(loose, 'entry', 'entries')}`;
  head.append(heading, actionButton('new-folder', 'New folder', PLUS_OUTLINE, addFolder));
  return head;
}

function renderFolderHead(path) {
  const parent = parentOf(path);
  const head = document.createElement('div');
  head.className = 'folder-head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'folder-back';
  back.title = parent === null ? 'Back to History' : `Back to ${parent.split('/').join(' › ')}`;
  back.append(icon('<path class="stroke" d="M10 3 5 8l5 5"/>'), parent === null ? 'History' : leafOf(parent));
  back.addEventListener('click', () => showFolder(parent));
  acceptDrops(back, parent);

  const title = document.createElement('div');
  title.className = 'folder-title';
  title.title = path.split('/').join(' › ');
  title.append(folderIcon());
  if (state.renamingFolder === path) {
    title.append(folderNameInput(path));
  } else {
    title.append(folderLabel(leafOf(path)));
    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    actions.append(
      actionButton('new-entry', 'New entry in this folder', PLUS_OUTLINE, createEntry),
      actionButton('new-folder', 'New folder inside this one', FOLDER_PLUS, addFolder),
      actionButton('rename', 'Rename folder', '<path class="stroke" d="m3 13 .6-2.600 7-7 2 2-7 7z"/>', () => startRenaming(path)),
      actionButton('trash', 'Delete folder', TRASH_OUTLINE, () => askToDelete(path)),
    );
    title.append(actions);
  }
  head.append(back, title);
  if (state.confirmingDelete === path) head.append(renderDeleteConfirm(path));
  if (state.folderNotice) {
    const notice = document.createElement('p');
    notice.className = 'folder-notice';
    notice.textContent = state.folderNotice;
    head.append(notice);
  }
  return head;
}

function openMoveMenu(entry, button) {
  const menu = $('movePopover');
  const wasOpen = !menu.hidden && state.moving === entry;
  closePopovers();
  if (wasOpen) return;
  state.moving = entry;
  const moveTo = (folder) => () => {
    closePopovers();
    moveEntry(entry, folder);
  };
  const choices = state.folders
    .filter((path) => path !== entry.folder)
    .map((path) => popoverButton(path.split('/').join(' › '), moveTo(path)));
  if (entry.folder !== null) choices.unshift(popoverButton('Back to History', moveTo(null)));
  choices.push(popoverButton('New Folder', async () => {
    closePopovers();
    try {
      const path = await makeFolder(state.openFolder);
      await moveEntry(entry, path);
      startRenaming(path);
    } catch (error) {
      console.error('Could not create folder:', error);
    }
  }));
  menu.replaceChildren(...choices);
  menu.hidden = false;
  const place = button.getBoundingClientRect();
  menu.style.left = `${place.left}px`;
  menu.style.top = `${Math.max(8, Math.min(place.bottom + 6, window.innerHeight - menu.offsetHeight - 8))}px`;
}

function renderEntries() {
  if ($('sidebar').hidden) return;
  const inFolder = state.openFolder !== null;
  const folders = childFolders(state.openFolder);
  const entries = state.entries.filter((entry) => entry.folder === state.openFolder);
  // Like a Finder window: folders first, then files, newest first.
  const grid = document.createElement('div');
  grid.className = 'file-grid';
  grid.append(...folders.map(renderFolder), ...entries.map(renderEntry));
  const parts = [inFolder ? renderFolderHead(state.openFolder) : renderToolbar()];
  if (grid.children.length) parts.push(grid);
  if (inFolder && !grid.children.length) {
    const empty = document.createElement('div');
    empty.className = 'folder-empty';
    empty.textContent = 'Nothing here yet. Use the buttons above to write here or add a folder, or drag something in.';
    parts.push(empty);
  }
  const list = $('entryList');
  list.replaceChildren(...parts);
  const nameInput = list.querySelector('.folder-input');
  if (nameInput) {
    nameInput.focus();
    nameInput.select();
  }
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
  $('movePopover').hidden = true;
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
  state.openFolder = entry.folder;
  renderEntries();
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
  const toggleHistory = () => {
    $('sidebar').hidden = !$('sidebar').hidden;
    renderEntries();
    editor.focus();
  };
  $('historyBtn').addEventListener('click', toggleHistory);
  $('topLogo').addEventListener('click', toggleHistory);
  $('historyHeader').addEventListener('click', () => api.openFolder());

  nav.addEventListener('mouseenter', () => setNavVisible(true));
  nav.addEventListener('mouseleave', () => {
    if (state.timerRunning) setNavVisible(false);
  });

  document.addEventListener('mousedown', (event) => {
    if (!event.target.closest('.anchor, #movePopover, .move')) closePopovers();
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

  // With the native drop handler off, a file dropped on the window would open in place of the app.
  const isFileDrag = (event) => [...event.dataTransfer.types].includes('Files');
  document.addEventListener('dragover', (event) => {
    if (isFileDrag(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'none';
    }
  });
  document.addEventListener('drop', (event) => {
    if (isFileDrag(event)) event.preventDefault();
  });
  document.addEventListener('dragend', () => { state.dragged = null; });

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
