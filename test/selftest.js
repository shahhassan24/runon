// Runs inside the real app when built with the `selftest` feature (see test/run.mjs).
(async () => {
  const { invoke } = window.__TAURI__.core;
  const results = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const equal = (actual, expected, message = '') => assert(actual === expected, `${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  const until = async (test, label = 'condition', ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const value = await test(); if (value) return value; await wait(40); }
    throw new Error(`timed out waiting for ${label}`);
  };
  const check = async (name, action) => {
    try { results.push({ name, ok: true, detail: (await action()) ?? '' }); }
    catch (error) { results.push({ name, ok: false, detail: String(error) }); }
  };
  const type = (text) => { editor.focus(); editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end'); editor.dispatchEvent(new InputEvent('input', { bubbles: true })); };
  const press = (key, modifiers = {}) => { const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }); (document.activeElement || document.body).dispatchEvent(event); return event; };
  const onDisk = () => invoke('read_entry', { filename: state.selected.filename });
  const saved = async (expected) => { await until(async () => (await onDisk()) === expected, 'save to disk'); };
  const visible = (el) => el.getBoundingClientRect().width > 0;
  const snap = async (name) => { await wait(300); await invoke('snapshot', { name }); await wait(450); };
  const openMenu = () => { if ($('menu').hidden) $('menuBtn').click(); };

  const newEntry = async () => { const before = state.entries.length; $('newEntryBtn').click(); await until(() => state.entries.length === before + 1 && editor.value === '', 'new entry'); };
  await until(() => state.selected, 'app to load');
  const phase = await invoke('selftest_phase');

  if (phase === 'shots') {
    $('guideClose').click();
    localStorage.setItem('colorScheme', 'light'); applyTheme('light');
    closePopovers(); await wait(700);
    await invoke('snapshot', { name: 'writing-light' }); await wait(700);
    applyTheme('dark'); $('historyBtn').click(); await wait(700);
    await invoke('snapshot', { name: 'history-dark' }); await wait(700);
    openSearch(); $('search').value = 'project'; await runSearch(); await wait(300); await invoke('snapshot', { name: 'search-dark' }); await wait(700); closeSearch();
    applyTheme('light'); $('sidebar').hidden = true;
    openSearch(); $('search').value = 'research'; await runSearch(); await wait(300); await invoke('snapshot', { name: 'search-light' }); await wait(700); closeSearch();
    await invoke('selftest_report', { report: '[]' });
    await invoke('exit_now');
    return;
  }

  if (phase === '2') {
    await check('relaunch: guide stays closed', async () => assert($('guide').hidden, 'guide reopened'));
    await check('relaunch: dark theme is remembered', async () => equal(document.documentElement.dataset.theme, 'dark'));
    await check('relaunch: timer length is remembered', async () => equal($('timerBtn').textContent, '20:00'));
    await check('relaunch: entries are listed', async () => { $('historyBtn').click(); assert(document.querySelectorAll('.entry').length >= 3, 'too few'); });
    await check('relaunch: text typed before quitting was saved', async () => {
      const { entries } = await api.listEntries();
      const bodies = await Promise.all(entries.map((e) => invoke('read_entry', { filename: e.filename })));
      assert(bodies.some((body) => body.includes('typed right before quitting')), 'lost');
    });
    await check('relaunch: opens today\'s empty entry or latest', async () => assert(state.selected, 'nothing selected'));
    await invoke('selftest_report', { report: JSON.stringify(results) });
    await invoke('exit_now');
    return;
  }

  await check('first launch: welcome guide opens', async () => { assert(!$('guide').hidden, 'hidden'); assert($('guide').textContent.includes('Begin anywhere'), 'text'); });
  await check('first launch: guide is not saved as an entry', async () => { equal(editor.value, ''); equal((await api.listEntries()).entries.length, 1); });
  await check('theme follows the system by default', async () => equal(document.documentElement.dataset.theme, matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  await snap('guide');
  await check('Start writing closes the guide', async () => { $('guideClose').click(); assert($('guide').hidden, 'open'); });
  await check('window title, toolbar and word count', async () => { equal(document.title, 'Runon'); assert(visible($('historyBtn')), 'no sidebar button'); assert(visible($('searchBtn')), 'no search field'); assert($('entryDate').textContent.length > 5, 'no date'); equal($('entryMeta').textContent, 'Empty'); });
  await check('Literata font loads', async () => { await document.fonts.load('18px Literata'); assert(document.fonts.check('18px Literata'), 'not loaded'); });

  await check('typing autosaves', async () => { type('hello runon'); await saved('hello runon'); });
  await check('new entry starts blank', async () => { await newEntry(); equal((await api.listEntries()).entries.length, 2); });
  await check('Cmd+N makes a new entry', async () => { const before = state.entries.length; press('n', { metaKey: true }); await until(() => state.entries.length === before + 1, 'entry'); });
  await check('backspace can be blocked', async () => {
    type('keep this');
    openMenu(); $('backspaceBtn').click(); equal($('backspaceBtn').getAttribute('aria-checked'), 'false');
    editor.focus(); assert(press('Backspace').defaultPrevented, 'Backspace not blocked'); assert(press('Delete').defaultPrevented, 'Delete not blocked');
    $('backspaceBtn').click(); equal($('backspaceBtn').getAttribute('aria-checked'), 'true'); editor.focus(); assert(!press('Backspace').defaultPrevented, 'still blocked');
    closePopovers();
  });

  await check('text size changes', async () => { $('sizeBtn').click(); equal($('sizeBtn').textContent, '20 pt'); equal(getComputedStyle(editor).fontSize, '20px'); });
  await check('fonts change and show as selected', async () => {
    document.querySelector('[data-font="Serif"]').click(); assert(/Times New Roman/.test(getComputedStyle(editor).fontFamily), 'font'); assert(document.querySelector('[data-font="Serif"]').classList.contains('active'), 'active');
    document.querySelector('[data-font="Arial"]').click(); assert(/Arial/.test(getComputedStyle(editor).fontFamily), 'font');
  });
  await check('Random picks a font installed on this computer', async () => {
    $('randomBtn').click(); await until(() => $('randomBtn').textContent.startsWith('Random ['), 'random font');
    assert(state.fontList.length > 20, `only ${state.fontList.length}`); return `${state.fontList.length} fonts`;
  });
  await check('toolbar fits with History open and a long font name', async () => {
    $('sidebar').hidden = false; renderEntries();
    $('randomBtn').textContent = 'Random [A Very Long Font Name That Goes On And On]';
    const items = [...document.querySelectorAll('#topbar > *, #nav > *')].filter((el) => el.id !== 'nav' && visible(el));
    const boxes = items.map((el) => el.getBoundingClientRect()).sort((a, b) => a.left - b.left);
    equal(boxes.filter((box, i) => i && box.left < boxes[i - 1].right - 0.5).length, 0, 'overlaps');
    equal($('topbar').scrollWidth <= $('topbar').clientWidth, true, 'overflow');
    $('formatBtn').click(); assert(!$('formatPanel').hidden, 'format popover'); assert($('formatPanel').scrollWidth <= $('formatPanel').clientWidth + 1, 'font name spills'); closePopovers();
    $('sidebar').hidden = true;
  });
  await check('back to Literata at normal size', async () => {
    document.querySelector('[data-font="Literata"]').click(); while ($('sizeBtn').textContent !== '18 pt') $('sizeBtn').click();
    equal($('randomBtn').textContent, 'Random');
  });

  await check('timer panel sets the time', async () => {
    $('timerBtn').click(); assert(!$('timerPanel').hidden, 'closed');
    document.querySelector('[data-minutes="20"]').click(); equal($('timerValue').textContent, '20:00');
    $('timerLess').click(); equal($('timerValue').textContent, '19:00');
    $('timerMore').click(); $('timerMore').click(); equal($('timerValue').textContent, '21:00');
    document.querySelector('[data-minutes="5"]').click(); equal($('timerBtn').textContent, '5:00');
  });
  await snap('timer');
  await check('scrolling over the time changes it', async () => {
    closePopovers(); $('timerBtn').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })); equal($('timerBtn').textContent, '10:00');
    $('timerBtn').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })); equal($('timerBtn').textContent, '5:00');
  });
  await check('session: start fades controls and the line grows', async () => {
    await newEntry();
    $('timerBtn').click(); $('timerStart').click();
    assert(state.timerRunning, 'not running'); assert(nav.classList.contains('faded'), 'bar visible'); assert($('topbar').classList.contains('faded'), 'top visible'); assert($('timerPanel').hidden, 'panel open');
    await until(() => parseFloat($('runlineFill').style.width) > 0, 'line to grow', 3000);
    equal(document.activeElement, editor, 'focus');
    await until(() => Number(getComputedStyle(nav).opacity) < 0.05, 'controls to fade out', 3000);
  });
  await check('session: hovering brings controls back', async () => { nav.dispatchEvent(new MouseEvent('mouseenter')); assert(!nav.classList.contains('faded'), 'faded'); nav.dispatchEvent(new MouseEvent('mouseleave')); assert(nav.classList.contains('faded'), 'not faded'); });
  await check('session: line fades when writing stops, returns on typing', async () => {
    type('one two three'); assert(!$('runline').classList.contains('idle'), 'idle too early');
    state.lastInput = Date.now() - 6000; await until(() => $('runline').classList.contains('idle'), 'fade', 2500);
    type(' four'); assert(!$('runline').classList.contains('idle'), 'still faded');
  });
  await snap('timer-running');
  await check('session: a pause clears the fade and keeps the time', async () => {
    state.lastInput = Date.now() - 6000; await until(() => $('runline').classList.contains('idle'), 'fade', 2500);
    $('timerBtn').click(); $('timerStart').click(); assert(!state.timerRunning, 'running'); assert(!$('runline').classList.contains('idle'), 'still faded'); assert(!nav.classList.contains('faded'), 'controls hidden after pause'); equal($('timerStart').textContent, 'Resume'); equal(state.timerClock, null, 'clock');
    $('timerStart').click(); assert(state.timerRunning, 'not resumed');
  });
  await check('session: the end shows a word summary and clears', async () => {
    state.timerEndsAt = Date.now() + 1500;
    await until(() => $('entryDate').textContent.includes('word'), 'summary', 5000);
    equal($('entryDate').textContent, '4 words in 5 minutes');
    assert($('runline').classList.contains('finished'), 'no pulse'); assert(!nav.classList.contains('faded'), 'controls hidden'); equal(state.timerClock, null, 'clock'); equal($('timerBtn').textContent, '0:00');
    $('timerBtn').click(); $('timerStart').click(); assert(!$('entryDate').textContent.includes('word'), 'summary stayed'); equal($('timerBtn').textContent, '5:00');
    $('timerBtn').click(); $('timerReset').click(); closePopovers(); assert(!state.timerRunning, 'running');
  });
  await check('session: counts words across entries', async () => {
    $('timerBtn').click(); $('timerStart').click(); type(' five');
    const before = state.entries.length; press('n', { metaKey: true }); await until(() => state.entries.length === before + 1 && editor.value === '', 'blank'); type('six seven');
    state.timerEndsAt = Date.now() + 1200;
    await until(() => $('entryDate').textContent.includes('word'), 'summary', 5000);
    equal($('entryDate').textContent, '3 words in 5 minutes');
  });
  await check('timer stays right if the page was slowed down', async () => {
    document.querySelector('[data-minutes="10"]').click(); $('timerStart').click();
    state.timerEndsAt = Date.now() + 300000; await until(() => $('timerBtn').textContent.startsWith('4:5') || $('timerBtn').textContent === '5:00', 'clock catch-up', 2500);
    $('timerBtn').click(); $('timerReset').click(); closePopovers();
    document.querySelector('[data-minutes="20"]').click();
    assert(!nav.classList.contains('faded'), 'controls hidden after reset');
  });

  const longEntry = `${'word '.repeat(90)}`;
  await check('chat: short entries are asked to write more', async () => {
    await newEntry(); type('too short');
    openMenu(); $('chatBtn').click(); assert($('chatPopover').textContent.includes('minimum 5 minutes'), $('chatPopover').textContent); closePopovers();
  });
  await check('chat: opens ChatGPT and Claude with the entry', async () => {
    editor.value = ''; type(longEntry); await wait(250);
    openMenu(); $('chatBtn').click();
    [...$('chatPopover').querySelectorAll('button')].find((b) => b.textContent === 'Claude').click();
    openMenu(); $('chatBtn').click();
    [...$('chatPopover').querySelectorAll('button')].find((b) => b.textContent === 'ChatGPT').click();
    const recorded = await until(async () => { const r = await invoke('selftest_recorded'); return r.length >= 2 && r; }, 'links');
    assert(recorded[0].startsWith('https://claude.ai/new?q=Take%20a%20look'), recorded[0].slice(0, 50));
    assert(recorded[1].startsWith('https://chatgpt.com/?q=below%20is'), recorded[1].slice(0, 50));
    assert(recorded[0].includes('word%20word'), 'entry missing');
  });
  await check('chat: only allowed sites can be opened', async () => {
    let refused = false; try { await invoke('open_chat', { url: 'https://example.com/?q=x' }); } catch { refused = true; } assert(refused, 'opened');
  });
  await check('chat: Copy Prompt includes the entry', async () => {
    openMenu(); $('chatBtn').click();
    const button = [...$('chatPopover').querySelectorAll('button')].find((b) => b.textContent === 'Copy Prompt'); button.click();
    await until(() => button.textContent === 'Copied!', 'copied');
    const recorded = await invoke('selftest_recorded'); assert(recorded[recorded.length - 1].includes('my entry:\n\nword word'), 'text'); closePopovers();
  });
  await check('chat: very long entries only offer copying', async () => {
    editor.value = ''; type('long '.repeat(2000)); openMenu(); $('chatBtn').click();
    assert($('chatPopover').textContent.includes('quite long'), 'text'); assert(![...$('chatPopover').querySelectorAll('button')].some((b) => b.textContent === 'Claude'), 'Claude offered'); closePopovers();
    editor.value = ''; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await check('files outside the entries folder are refused', async () => {
    for (const filename of ['../../etc/hosts', 'x.md', '[../../../../../../../../../etc/passwd]-[2026-02-20-08-01-04].md']) {
      let refused = false; try { await invoke('read_entry', { filename }); } catch { refused = true; } assert(refused, filename);
    }
  });

  await check('history lists entries by day and switching keeps text', async () => {
    await newEntry(); type('first entry text'); await saved('first entry text');
    await newEntry(); type('second entry text'); await saved('second entry text');
    $('historyBtn').click(); assert(!$('sidebar').hidden, 'hidden');
    assert(document.querySelector('.file-grid .entry.selected'), 'selected entry not shown in the grid');
    const row = [...document.querySelectorAll('.entry')].find((e) => e.textContent.includes('first entry text')); row.click();
    await until(() => editor.value === 'first entry text', 'first');
    [...document.querySelectorAll('.entry')].find((e) => e.textContent.includes('second entry text')).click();
    await until(() => editor.value === 'second entry text', 'second');
    openMenu(); $('aboutBtn').click(); assert(!$('alert').hidden, 'about'); assert($('alertMessage').textContent.includes('Built by Shah Hassan'), 'credit'); $('alertConfirm').click(); assert($('alert').hidden, 'about stayed open');
  });
  await check('folders: entries and folders move on disk, and deleting keeps the writing', async () => {
    const entry = state.selected;
    const top = await makeFolder(null);
    await renameFolder(top, 'Selftest');
    const inner = await makeFolder('Selftest');
    await renameFolder(inner, 'Inner');
    await moveEntry(entry, 'Selftest/Inner');
    type(' filed away'); await saved(editor.value);
    let listed = await api.listEntries();
    assert(listed.folders.includes('Selftest/Inner'), 'nested folder not listed');
    equal(listed.entries.find((e) => e.filename === entry.filename).folder, 'Selftest/Inner', 'entry folder');
    await renameFolder('Selftest', 'Selftest Renamed');
    equal(entry.folder, 'Selftest Renamed/Inner', 'path after rename');
    await deleteFolder('Selftest Renamed');
    listed = await api.listEntries();
    assert(!listed.folders.some((f) => f.startsWith('Selftest')), 'folder still there');
    equal(listed.entries.find((e) => e.filename === entry.filename).folder, null, 'entry not moved to the top');
    equal(await onDisk(), editor.value, 'writing kept');
  });
  const searchFor = async (text) => { $('search').value = text; await runSearch(); };
  await check('Cmd+F opens the floating search, and again closes it', async () => {
    type(' unsaved kumquat');
    press('f', { metaKey: true }); assert(!$('spotlight').hidden, 'closed'); equal(document.activeElement, $('search'), 'focus'); assert($('searchResults').hidden, 'old results');
    press('f', { metaKey: true }); assert($('spotlight').hidden, 'still open');
    press('f', { metaKey: true });
  });
  await check('search finds text in any entry, even just typed', async () => {
    await searchFor('KUMQUAT');
    await until(() => document.querySelector('.result mark'), 'result'); equal(document.querySelector('.result mark').textContent, 'kumquat');
    assert(document.querySelector('.result').classList.contains('active'), 'first result not chosen');
    await searchFor('zzzqqq'); assert(document.querySelector('.result-empty'), 'no message');
    await searchFor('(kumquat'); assert(document.querySelector('.result-empty'), 'special characters');
    $('search').value = ''; await runSearch(); assert($('searchResults').hidden, 'empty search shows results');
  });
  await check('arrow keys move through results and wrap around', async () => {
    await searchFor('entry text');
    await until(() => document.querySelectorAll('.result').length === 2, 'two results');
    const active = () => [...document.querySelectorAll('.result')].findIndex((row) => row.classList.contains('active'));
    equal(active(), 0); press('ArrowDown'); equal(active(), 1); press('ArrowDown'); equal(active(), 0); press('ArrowUp'); equal(active(), 1);
  });
  await check('Return opens the chosen result and closes search', async () => {
    const chosen = document.querySelector('.result.active .result-snippet').textContent;
    press('Enter'); assert($('spotlight').hidden, 'still open');
    await until(() => chosen.includes(editor.value) && editor.value.length > 0, 'entry');
    equal(document.activeElement, editor, 'focus');
  });
  await check('clicking a result jumps to the match', async () => {
    const lines = Array.from({ length: 120 }, (_, i) => `filler line ${i}`).join('\n');
    await newEntry();
    editor.value = `${lines}\nthe hidden Marmalade recipe\n${lines}`; editor.dispatchEvent(new InputEvent('input', { bubbles: true })); await wait(300);
    await newEntry();
    press('f', { metaKey: true }); await searchFor('marmalade');
    await until(() => document.querySelector('.result'), 'result'); document.querySelector('.result').click();
    await until(() => editor.value.includes('Marmalade'), 'open');
    await wait(150);
    equal(editor.selectionStart, editor.value.indexOf('Marmalade'), 'caret');
    assert(editor.scrollTop > 200 && editor.scrollTop < editor.scrollHeight - editor.clientHeight - 200, `scroll ${editor.scrollTop}`);
  });
  await check('Escape and clicking outside close search', async () => {
    press('f', { metaKey: true }); press('Escape'); assert($('spotlight').hidden, 'Escape'); equal(document.activeElement, editor, 'focus');
    press('f', { metaKey: true }); $('spotlight').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); assert($('spotlight').hidden, 'click outside');
    $('searchBtn').click(); assert(!$('spotlight').hidden, 'toolbar search field'); press('Escape');
  });
  await check('search does not open over the welcome guide', async () => { openGuide(); press('f', { metaKey: true }); assert($('spotlight').hidden, 'opened'); $('guide').hidden = true; });

  await check('deleting an entry removes it', async () => {
    await newEntry();
    const before = (await api.listEntries()).entries.length;
    document.querySelector('.entry .trash').click();
    await until(async () => (await api.listEntries()).entries.length === before - 1, 'delete'); assert(state.selected, 'nothing selected'); assert(visible(editor), 'no editor');
  });

  await check('PDF export writes a complete multi-page file', async () => {
    editor.value = ''; type(`${'This is a long entry that should fill several pages when it is exported. '.repeat(120)}\n\nارد و کا جملہ\n\nTHE LAST SENTENCE`);
    await wait(300); flushSave();
    const ok = await api.exportPdf({ filename: state.selected.filename, fontFamily: state.fontFamily, fontSize: state.fontSize });
    equal(ok, true, 'result');
    editor.value = ''; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await check('dark mode, label and icon', async () => {
    if (document.documentElement.dataset.theme === 'dark') applyTheme('light');
    openMenu(); equal($('themeBtn').getAttribute('aria-checked'), 'false'); assert(visible($('moonIcon')), 'moon');
    $('themeBtn').click(); await wait(600);
    equal(document.documentElement.dataset.theme, 'dark'); equal(getComputedStyle($('main')).backgroundColor, 'rgb(28, 28, 30)'); equal($('themeBtn').getAttribute('aria-checked'), 'true'); assert(visible($('sunIcon')), 'sun');
    assert(!document.documentElement.classList.contains('theme-fading'), 'fade class stayed'); closePopovers();
  });
  await check('welcome guide opens from the menu and Escape closes it', async () => { openMenu(); $('guideBtn').click(); assert(!$('guide').hidden, 'closed'); press('Escape'); assert($('guide').hidden, 'open'); });

  await check('pictures for review', async () => {
    editor.value = 'I keep saying I want to start the project, but every time I sit down I find one more thing to research first. Maybe the research is the hiding place.\n\nSo, one small version. This week.';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true })); await wait(250);
    renderEntries(); await snap('history-dark');
    openSearch(); $('search').value = 'research'; await runSearch(); await snap('search-dark'); closeSearch();
    toggleTheme(); await wait(600); $('sidebar').hidden = true; openMenu(); await snap('menu-light'); closePopovers(); toggleTheme(); await wait(600);
  });
  await check('fullscreen turns on and off', async () => {
    openMenu(); $('fullscreenBtn').click(); await until(() => $('fullscreenLabel').textContent === 'Exit Full Screen', 'fullscreen', 6000);
    assert(document.documentElement.classList.contains('fullscreen'), 'class');
    await wait(900); $('fullscreenBtn').click(); await until(() => $('fullscreenLabel').textContent === 'Enter Full Screen', 'exit', 6000); await wait(900);
  });
  await check('no errors', async () => '');

  editor.focus();
  await invoke('selftest_report', { report: JSON.stringify(results) });
  type(' typed right before quitting');
  window.__TAURI__.event.emit('flush');
})().catch((error) => window.__TAURI__.core.invoke('selftest_report', { report: JSON.stringify([{ name: 'test script', ok: false, detail: String(error) }]) }));
