#!/usr/bin/env node
// Build the native half of this plugin, for the computer this runs on:
//
//   driver/worker/bin/bb60-worker        macOS on Apple Silicon (clang++)
//   driver/worker/bin/bb60-worker.exe    Windows x64 (MSVC)
//
//   node scripts/build-worker.mjs
//
// It needs a C++ compiler and nothing else — Xcode's command line tools, or
// Visual Studio's "Desktop development with C++" (the Build Tools are enough).
// Signal Hound's library is not linked: the worker loads it at run time from
// wherever the user installed it (see README, "Setup"), so nothing of theirs
// is needed to build, and nothing of theirs ends up in driver/worker/bin/ or
// in a release zip.
//
// bin/ is gitignored; scripts/pack-release.mjs carries it into the release,
// which holds both workers. So this replaces only the one it builds.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKER = join(ROOT, 'driver', 'worker');
const BIN = join(WORKER, 'bin');

const log = (msg) => process.stdout.write(`[build-worker] ${msg}\n`);
const fail = (msg) => {
  process.stderr.write(`[build-worker] ERROR: ${msg}\n`);
  process.exit(1);
};
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error || r.status !== 0) fail(`${cmd} ${args.join(' ')} failed`);
};

const SOURCE = join(WORKER, 'bb60_worker.cpp');
const target = `${process.platform}-${process.arch}`;

function buildMac(worker) {
  run('clang++', [
    '-std=c++17',
    '-O2',
    '-Wall',
    '-arch',
    'arm64',
    '-mmacosx-version-min=13.0',
    SOURCE,
    '-o',
    worker,
  ]);
  chmodSync(worker, 0o755);
}

// cl.exe only works inside a Visual Studio environment, so find one and run
// the compiler in it. vswhere ships with every Visual Studio since 2017, at a
// path that does not move.
function buildWindows(worker) {
  const vswhere = join(
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe'
  );
  const found = existsSync(vswhere)
    ? spawnSync(
        vswhere,
        [
          '-latest',
          '-products',
          '*',
          '-requires',
          'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
          '-property',
          'installationPath',
        ],
        { encoding: 'utf8' }
      ).stdout?.trim()
    : '';
  const vcvars = found
    ? join(found.split(/\r?\n/)[0], 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
    : '';
  if (!vcvars || !existsSync(vcvars)) {
    fail(
      'no C++ compiler found — install Visual Studio Build Tools with the ' +
        '"Desktop development with C++" workload'
    );
  }
  const obj = join(tmpdir(), `bb60-worker-${process.pid}.obj`);
  // /MT: the C++ runtime is linked in, so the worker needs no redistributable
  const cl = `cl /nologo /std:c++17 /O2 /EHsc /MT /W3 /utf-8 "${SOURCE}" /Fo"${obj}" /Fe"${worker}"`;
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"call "${vcvars}" >nul && ${cl}"`], {
    stdio: 'inherit',
    windowsVerbatimArguments: true,
  });
  rmSync(obj, { force: true });
  if (r.error || r.status !== 0) fail('cl failed');
}

// Signal Hound builds its library for these two and nothing else, so there is
// nothing worth building anywhere else — and a CI matrix that includes other
// targets should not fail for it. The JavaScript tests run everywhere against
// the fake worker.
const BUILDS = {
  'darwin-arm64': { name: 'bb60-worker', build: buildMac },
  'win32-x64': { name: 'bb60-worker.exe', build: buildWindows },
};
const mine = BUILDS[target];
if (!mine) {
  log(
    `nothing to build on ${target}: this plugin drives a BB60 on macOS ` +
      '(Apple Silicon) and Windows (x64) only'
  );
  process.exit(0);
}

mkdirSync(BIN, { recursive: true });
const worker = join(BIN, mine.name);
rmSync(worker, { force: true });
mine.build(worker);

// Prove it starts, here, before a user finds out it does not.
const probe = spawnSync(worker, ['--mock', '--list'], { encoding: 'utf8' });
if (probe.status !== 0 || !probe.stdout.includes('"devices"')) {
  fail(`the worker does not start: ${probe.stderr?.trim() || probe.error}`);
}
log(`built ${worker}`);
