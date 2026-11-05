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
  const timestampOf = (filename) => {
    const m = filename.match(/\]-\[(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\]\.md$/);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  };
  const describe = (filename, content) => {
    const timestamp = timestampOf(filename);
    return {
      filename,
      timestamp: timestamp.getTime(),
      displayDate: timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      previewText: previewOf(content),
      words: countWords(content),
    };
  };

  // Writes happen one at a time, in order, so the newest text always lands last.
  let pendingWrites = Promise.resolve();
  const write = (filename, text) => {
    pendingWrites = pendingWrites.then(() => invoke('write_entry', { filename, text }));
    return pendingWrites;
  };

  const MAX_SEARCH_RESULTS = 100;
  const CHAT_URLS = { chatgpt: 'https://chatgpt.com/?q=', claude: 'https://claude.ai/new?q=' };

  window.runon = {
    platform: navigator.platform.startsWith('Mac') ? 'darwin' : 'win32',
    setTheme: (theme) => invoke('set_theme', { dark: theme === 'dark' }),
    listEntries: async () => {
      const raw = await invoke('list_entries');
      const entries = raw
        .map(({ filename, content }) => describe(filename, content))
        .sort((a, b) => (b.timestamp - a.timestamp) || b.filename.localeCompare(a.filename));
      return { entries, folder: await invoke('folder') };
    },
    createEntry: async () => {
      const now = new Date();
      const stamp = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('-');
      const filename = `[${crypto.randomUUID().toUpperCase()}]-[${stamp}].md`;
      await write(filename, '');
      return describe(filename, '');
    },
    readEntry: async (filename) => (await invoke('read_entry', { filename })).replace(/^\n+/, ''),
    saveEntry: (filename, text) => {
      write(filename, text).catch((error) => {
        console.error('Could not save entry:', error);
        pendingWrites = Promise.resolve();
        window.dispatchEvent(new Event('runon-save-failed'));
      });
      return { previewText: previewOf(text), words: countWords(text) };
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
