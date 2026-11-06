// Connects the interface to the native side of the app.
(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const pad = (value) => String(value).padStart(2, '0');
  const countWords = (text) => text.split(/\s+/).filter(Boolean).length;
  const previewOf = (content) => {
    const preview = content.replace(/\n/g, ' ').trim();
    return preview.length > 30 ? `${preview.slice(0, 30)}...` : preview;
  };
  const thumbOf = (content) => content.trim().slice(0, 400);
  const timestampOf = (filename) => {
    const m = filename.match(/\]-\[(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\]\.md$/);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  };
  const describe = (filename, content, folder = null) => {
    const timestamp = timestampOf(filename);
    return {
      filename,
      folder,
      timestamp: timestamp.getTime(),
      displayDate: timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      previewText: previewOf(content),
      thumbText: thumbOf(content),
      words: countWords(content),
    };
  };

  // Writes happen one at a time, in order, so the newest text always lands last.
  let pendingWrites = Promise.resolve();
  const write = (filename, text) => {
    pendingWrites = pendingWrites.then(() => invoke('write_entry', { filename, text }));
    return pendingWrites;
  };

  // Moving and renaming wait their turn too, so a save never races a move.
  const inOrder = (command, args) => {
    const run = pendingWrites.catch(() => {}).then(() => invoke(command, args));
    pendingWrites = run.catch(() => {});
    return run;
  };
  const moveEntry = (filename, folder) => inOrder('move_entry', { filename, folder });

  const MAX_SEARCH_RESULTS = 100;
  const CHAT_URLS = { chatgpt: 'https://chatgpt.com/?q=', claude: 'https://claude.ai/new?q=' };

  window.runon = {
    platform: navigator.platform.startsWith('Mac') ? 'darwin' : 'win32',
    // null hands the choice back to the system appearance.
    setTheme: (theme) => invoke('set_theme', { dark: theme === null ? null : theme === 'dark' }),
    listEntries: async () => {
      const raw = await invoke('list_entries');
      const entries = raw
        .map(({ filename, content, folder }) => describe(filename, content, folder))
        .sort((a, b) => (b.timestamp - a.timestamp) || b.filename.localeCompare(a.filename));
      return { entries, folders: await invoke('list_folders'), folder: await invoke('folder') };
    },
    createFolder: (name) => inOrder('create_folder', { name }),
    renameFolder: (name, newName) => inOrder('rename_folder', { name, newName }),
    deleteFolder: (name) => inOrder('delete_folder', { name }),
    moveFolder: (name, into) => inOrder('move_folder', { name, into }),
    moveEntry,
    createEntry: async (folder = null) => {
      const now = new Date();
      const stamp = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('-');
      const filename = `[${crypto.randomUUID().toUpperCase()}]-[${stamp}].md`;
      await write(filename, '');
      if (folder) {
        // If the folder has gone, the entry stays at the top instead of getting lost.
        try {
          await moveEntry(filename, folder);
        } catch (error) {
          console.error('Could not put the new entry in its folder:', error);
          return describe(filename, '');
        }
      }
      return describe(filename, '', folder);
    },
    readEntry: async (filename) => (await invoke('read_entry', { filename })).replace(/^\n+/, ''),
    saveEntry: (filename, text) => {
      write(filename, text).catch((error) => {
        console.error('Could not save entry:', error);
        pendingWrites = Promise.resolve();
        window.dispatchEvent(new Event('runon-save-failed'));
      });
      return { previewText: previewOf(text), thumbText: thumbOf(text), words: countWords(text) };
    },
    searchEntries: async (query) => {
      const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
      await pendingWrites;
      const raw = (await invoke('list_entries')).sort((a, b) => timestampOf(b.filename) - timestampOf(a.filename));
      const results = [];
      for (const { filename, content } of raw) {
        const match = pattern.exec(content);
        if (match) {
          const start = Math.max(0, match.index - 30);
          const end = match.index + match[0].length + 70;
          const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
          results.push({ filename, snippet: `${start > 0 ? '…' : ''}${snippet}${end < content.length ? '…' : ''}` });
          if (results.length === MAX_SEARCH_RESULTS) break;
        }
      }
      return results;
    },
    deleteEntry: (filename) => invoke('trash_entry', { filename }),
    exportPdf: async ({ filename, fontFamily, fontSize }) => {
      await pendingWrites;
      return invoke('export_pdf', { filename, fontFamily, fontSize });
    },
    listFonts: () => invoke('list_fonts'),
    openFolder: () => invoke('open_folder'),
    openChat: (provider, text) => invoke('open_chat', { url: CHAT_URLS[provider] + encodeURIComponent(text) }),
    copyText: (text) => invoke('copy_text', { text: String(text) }),
    toggleFullscreen: () => invoke('toggle_fullscreen'),
    onFullscreenChange: (callback) => { listen('fullscreen', ({ payload }) => callback(payload)); },
    onNewEntry: (callback) => {
      document.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
          event.preventDefault();
          callback();
        }
      });
    },
    flushed: () => pendingWrites,
  };

  // Sent just before the app quits: finish saving first.
  listen('flush', async () => {
    try {
      flushSave();
      await pendingWrites;
    } finally {
      invoke('exit_now');
    }
  });
})();
