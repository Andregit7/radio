import { LIMITS, parseJSON, requireThat, safePath } from './schema.js';

const MANIFEST_LIMIT = 4 * 1024;
const revisionPattern = /^(?:0|[1-9]\d{0,8})(?:\.(?:0|[1-9]\d{0,8})){0,3}$/;
const packIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;

export function comparePackRevisions(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !revisionPattern.test(a) || !revisionPattern.test(b)) return null;
  const first = a.split('.').map(Number), second = b.split('.').map(Number);
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    const delta = (first[i] ?? 0) - (second[i] ?? 0);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

export function validateDefaultPackManifest(raw) {
  requireThat(raw && typeof raw === 'object' && !Array.isArray(raw), 'Datele pachetului de curs sunt invalide.');
  const { id, title, revision, path, cases, bytes, sha256 } = raw;
  requireThat(typeof id === 'string' && packIdPattern.test(id) && !['constructor', 'prototype'].includes(id) &&
    typeof title === 'string' && title.trim() && title.length <= 200 &&
    typeof revision === 'string' && revisionPattern.test(revision) &&
    safePath(path) && /^packs\/[a-zA-Z0-9_.-]+\.study\.zip$/.test(path) &&
    Number.isInteger(cases) && cases > 0 && cases <= LIMITS.cases &&
    Number.isInteger(bytes) && bytes > 0 && bytes <= LIMITS.archive &&
    typeof sha256 === 'string' && /^[0-9a-f]{64}$/.test(sha256), 'Datele pachetului de curs sunt invalide.');
  return { id, title, revision, path, cases, bytes, sha256 };
}

export function defaultPackAction(manifest, record) {
  if (!manifest) return null;
  if (!record) return 'install';
  if (comparePackRevisions(manifest.revision, record.pack.revision) !== 1) return null;
  return record.hostedSha256 ? 'update' : 'replace';
}

async function readLimited(response, limit, onProgress = () => {}) {
  const reader = response.body?.getReader();
  requireThat(reader, 'Serverul nu a trimis conținutul așteptat.');
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return new Blob(chunks);
      bytes += value.byteLength;
      requireThat(bytes <= limit, 'Fișierul descărcat depășește dimensiunea așteptată.');
      chunks.push(value);
      onProgress(bytes / limit);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export async function fetchDefaultPackManifest(base) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(new URL('./default-pack.json', base), {
      cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    if (response.status === 404) return null;
    requireThat(response.ok, 'Nu am putut verifica pachetul de curs.');
    const blob = await readLimited(response, MANIFEST_LIMIT);
    return validateDefaultPackManifest(parseJSON(await blob.text(), MANIFEST_LIMIT));
  } finally { clearTimeout(timer); }
}

export async function downloadDefaultPack(base, manifest, signal, onProgress) {
  const response = await fetch(new URL(manifest.path, base), { cache: 'no-store', redirect: 'error', signal });
  requireThat(response.ok, 'Pachetul de curs nu poate fi descărcat.');
  const blob = await readLimited(response, manifest.bytes, onProgress);
  requireThat(blob.size === manifest.bytes, 'Descărcarea pachetului de curs este incompletă.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  const sha256 = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
  requireThat(sha256 === manifest.sha256, 'Arhiva descărcată nu corespunde versiunii publicate.');
  return blob;
}

export function validateDefaultPackContents(pack, manifest) {
  requireThat(pack.id === manifest.id && pack.revision === manifest.revision &&
    pack.title === manifest.title && pack.cases.length === manifest.cases,
    'Conținutul arhivei nu corespunde pachetului de curs publicat.');
}
