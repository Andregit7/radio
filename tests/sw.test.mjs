import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('both service workers honor the explicit activation message', async () => {
  for (const file of ['../dist/sw.js', '../studio/sw.js']) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(text, /addEventListener\('message'/, `${file} has no message handler`);
    assert.match(text, /ACTIVATE_UPDATE/, `${file} ignores ACTIVATE_UPDATE`);
    assert.match(text, /skipWaiting\(\)/, `${file} does not call skipWaiting()`);
  }
});

test('both service workers use a content-hash version and shell cache', async () => {
  for (const file of ['../dist/sw.js', '../studio/sw.js']) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(text, /const VERSION='\d+\.\d+\.\d+-[0-9a-f]{12}'/, `${file} must carry the release build hash`);
    assert.match(text, /const FILES=\[/, `${file} must list its shell`);
    assert.match(text, /caches\.open\(CACHE\)/, `${file} must install the shell cache`);
  }
});
