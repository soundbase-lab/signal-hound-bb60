// Finding Signal Hound's library. It is the user's to install, so where it is
// differs from computer to computer; these pin down the order the plugin
// looks in. The library's name is the platform's: libbb_api.<version>.dylib on
// macOS, plain bb_api.dll on Windows.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findLibrary } from '../driver/bb60-driver.js';

const WINDOWS = process.platform === 'win32';
const LIBRARY = WINDOWS ? 'bb_api.dll' : 'libbb_api.5.dylib';

const folderWith = (...names) => {
  const dir = mkdtempSync(join(tmpdir(), 'bb60-lib-'));
  for (const name of names) writeFileSync(join(dir, name), '');
  return dir;
};

test('a file named in the plugin setting is used as it is', () => {
  const file = join(folderWith('anything.dylib'), 'anything.dylib');
  assert.equal(findLibrary({ libraryPath: ` ${file} ` }, {}), file);
});

// macOS only: the Windows library carries no version in its name
test('a folder is searched for the library, newest version first', { skip: WINDOWS }, () => {
  const dir = folderWith(
    'libbb_api.5.0.11.dylib',
    'libbb_api.5.0.12.dylib',
    'libusb-1.0.0.dylib',
    'notes.txt'
  );
  assert.equal(
    findLibrary({ libraryPath: dir }, {}),
    join(dir, 'libbb_api.5.0.12.dylib')
  );
});

test('a folder is searched for the library among what sits beside it', () => {
  const dir = folderWith(LIBRARY, 'FTD2XX.dll', 'sa_api.dll', 'notes.txt');
  assert.equal(findLibrary({ libraryPath: dir }, {}), join(dir, LIBRARY));
});

test('a path pasted in quotes is read as the path inside them', () => {
  const dir = folderWith(LIBRARY);
  assert.equal(
    findLibrary({ libraryPath: `"${join(dir, LIBRARY)}"` }, {}),
    join(dir, LIBRARY)
  );
});

test('the plugin setting wins over the environment', () => {
  const setting = folderWith(LIBRARY);
  const env = folderWith(LIBRARY);
  assert.equal(
    findLibrary({ libraryPath: setting }, { SB_BB60_LIBRARY: env }),
    join(setting, LIBRARY)
  );
  assert.equal(
    findLibrary({}, { SB_BB60_LIBRARY: env }),
    join(env, LIBRARY)
  );
});

test('a setting that points at nothing falls through rather than failing', () => {
  const env = folderWith(LIBRARY);
  assert.equal(
    findLibrary({ libraryPath: join(tmpdir(), 'bb60-no-such-folder') }, { SB_BB60_LIBRARY: env }),
    join(env, LIBRARY)
  );
});
