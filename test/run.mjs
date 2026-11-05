// Runs the app twice with a temporary folder and checks everything it reports.
// Nothing here touches your real entries, settings, clipboard, browser, or Trash.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const binary = path.join(root, 'src-tauri/target/release/runon');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'runon-test-'));
const dataDir = path.join(work, 'entries');
const pdfPath = path.join(work, 'export.pdf');
const shots = process.argv[2] || work;
fs.mkdirSync(dataDir);
// A build run outside an app bundle keeps its settings under its process name.
for (const dir of ['WebKit', 'Caches']) fs.rmSync(path.join(os.homedir(), 'Library', dir, 'runon'), { recursive: true, force: true });

const failures = [];
let passed = 0;
const report = (name, ok, detail = '') => {
  if (ok) passed += 1; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

function run(phase) {
  const reportPath = path.join(shots === work ? work : shots, `report-${phase}`);
  fs.rmSync(reportPath, { force: true });
  return new Promise((resolve) => {
    const app = spawn(binary, [], { env: { ...process.env, RUNON_DATA_DIR: dataDir, RUNON_PDF_PATH: pdfPath, RUNON_SELFTEST: reportPath, RUNON_SELFTEST_PHASE: phase }, stdio: 'ignore' });
    const timeout = setTimeout(() => { report(`phase ${phase} finished in time`, false); app.kill(); }, 180000);
    app.on('exit', () => {
      clearTimeout(timeout);
      const results = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : [];
      if (!results.length) report(`phase ${phase} wrote results`, false);
      for (const { name, ok, detail } of results) report(name, ok, String(detail));
      resolve();
    });
  });
}

await run('1');

report('app quit by itself after finishing', true);
report('no temporary files left behind', !fs.readdirSync(dataDir).some((name) => !name.endsWith('.md')), fs.readdirSync(dataDir).filter((n) => !n.endsWith('.md')).join(', '));

if (fs.existsSync(pdfPath)) {
  const tool = path.join(work, 'pdfcheck');
  execFileSync('swiftc', ['-O', path.join(root, 'test/pdfcheck.swift'), '-o', tool], { stdio: 'ignore' });
  const pdf = JSON.parse(execFileSync(tool, [pdfPath], { encoding: 'utf8' }));
  report('PDF: several Letter pages', pdf.pages >= 2 && pdf.width === 612 && pdf.height === 792, `${pdf.pages} pages, ${pdf.width}x${pdf.height}`);
  report('PDF: starts and ends correctly, no text repeated', pdf.first && pdf.last && pdf.copies === 1);
  report('PDF: contains no app interface text', !pdf.ui);
  report('PDF: every page has text', pdf.pageChars.every((count) => count > 0), pdf.pageChars.join(', '));
  report('PDF: embeds the Literata font', fs.readFileSync(pdfPath).includes('Literata'));
  if (shots !== work) fs.copyFileSync(pdfPath, path.join(shots, 'export.pdf'));
} else {
  report('PDF file was created', false);
}

await run('2');

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
