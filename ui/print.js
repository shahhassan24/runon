// Splits an entry into Letter-size pages with 1-inch margins, breaking only between lines.
(async () => {
  const { invoke } = window.__TAURI__.core;
  const job = await invoke('pdf_job');
  if (!job) return;
  const CONTENT_HEIGHT = 648;
  const measure = document.getElementById('measure');
  const style = (element) => {
    element.style.fontFamily = job.font_family;
    element.style.fontSize = `${job.font_size}px`;
    element.style.lineHeight = `${job.font_size * 1.5}px`;
  };
  style(measure);
  await document.fonts.load(`${job.font_size}px "Literata"`).catch(() => {});
  await document.fonts.ready;

  const fits = (text) => {
    measure.textContent = text;
    return measure.offsetHeight <= CONTENT_HEIGHT;
  };

  const pages = [];
  let start = 0;
  while (start < job.text.length) {
    let low = 1;
    let high = job.text.length - start;
    if (fits(job.text.slice(start))) {
      low = high;
    } else {
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(job.text.slice(start, start + middle))) low = middle;
        else high = middle - 1;
      }
      const lastBreak = job.text.slice(start, start + low).search(/\s\S*$/);
      if (lastBreak > 0) low = lastBreak + 1;
    }
    pages.push(job.text.slice(start, start + low));
    start += low;
  }
  if (!pages.length) pages.push('');

  document.getElementById('pages').replaceChildren(...pages.map((text) => {
    const page = document.createElement('div');
    page.className = 'page';
    const content = document.createElement('div');
    content.className = 'text';
    style(content);
    content.textContent = text;
    page.append(content);
    return page;
  }));
  measure.remove();
  invoke('pdf_layout', { pages: pages.length });
})();
