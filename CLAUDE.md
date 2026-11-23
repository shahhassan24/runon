<!-- moot:begin (generated from hub@b2873c29; edit rules in moot, not here) -->
# moot

## How I work
- Keep replies short. Do the work, don't narrate it.
- Change only what the task needs. No refactors or formatting sweeps.
- Run the project's tests and lint before saying done.
- Never read or print secrets (.env, keys, credentials).

## Rules
- [handoff-notes] Client projects document handoff steps before delivery. Confirm deploy, access and handoff notes are written.
- [no-console-log] No console.log in shipped source. Use a logger or remove the call.
- [readme-exists] Every project has a README.md. Keep it short: what, how to run, how to test.

## Project brief
# runon

## What
Most of us edit while we write, and that gets in the way of finding out what we actually think.

## Architecture
- Stack: Rust, Tauri
- Mostly JavaScript, Rust, CSS
- Main dirs: `src-tauri/`, `ui/`, `build/`, `docs/`, `test/`

## Commands
- build: `npm run build`
- test: `npm test`
- test: `cd src-tauri && cargo test`
- lint: `cd src-tauri && cargo clippy`

## Conventions
- package manager: npm
- CI: GitHub Actions (build)
- tests in tests/ directories


## Gotchas
- Moot sessions scoped to the runon worktree cannot edit lordshady-main-portfolio; its Runon page (src/pages/tools/runon.astro) needs a session opened on that repo.
<!-- moot:end -->
