import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { isValidHash } from './hash.js';

// Candidate entry files, in priority order.
export const ENTRY_CANDIDATES = ['index.html', 'main.html'];

function normalizeEntryName(name) {
  return name.split(path.sep).join('/');
}

export class BundleStore {
  constructor(sitesDir) {
    if (!sitesDir) throw new Error('sitesDir is required');
    this.sitesDir = sitesDir;
    fs.mkdirSync(sitesDir, { recursive: true });
  }

  dirFor(hash) {
    if (!isValidHash(hash)) {
      throw new Error(`Invalid hash: ${hash}`);
    }
    return path.join(this.sitesDir, hash);
  }

  async exists(hash) {
    if (!isValidHash(hash)) return false;
    try {
      const st = await fsp.stat(this.dirFor(hash));
      return st.isDirectory();
    } catch {
      return false;
    }
  }

  // Resolve the entry HTML file (relative name) for a bundle, or null if none.
  resolveEntry(hash) {
    const dir = this.dirFor(hash);
    for (const candidate of ENTRY_CANDIDATES) {
      try {
        if (fs.statSync(path.join(dir, candidate)).isFile()) return candidate;
      } catch {
        // keep looking
      }
    }
    return null;
  }

  async remove(hash) {
    await fsp.rm(this.dirFor(hash), { recursive: true, force: true });
  }

  // Extract a zip buffer into the bundle directory for `hash`.
  // Returns { totalBytes, fileCount, entryFile }.
  async extractZip(hash, buffer) {
    const dir = this.dirFor(hash);
    const rootPrefix = dir + path.sep;

    let zip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new BundleError('invalid_zip');
    }

    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    if (entries.length === 0) {
      throw new BundleError('empty_zip');
    }

    const stripPrefix = computeCommonPrefix(entries.map((e) => e.entryName));

    await fsp.mkdir(dir, { recursive: true });

    let totalBytes = 0;
    let fileCount = 0;
    try {
      for (const entry of entries) {
        let rel = entry.entryName.replace(/\\/g, '/');
        if (stripPrefix && rel.startsWith(stripPrefix)) {
          rel = rel.slice(stripPrefix.length);
        }
        rel = rel.replace(/^\/+/, '');
        if (rel === '' || ignoredEntry(rel)) continue;

        const target = path.resolve(dir, rel);
        if (target !== dir && !target.startsWith(rootPrefix)) {
          throw new BundleError('unsafe_zip_entry');
        }

        await fsp.mkdir(path.dirname(target), { recursive: true });
        const data = entry.getData();
        await fsp.writeFile(target, data);
        totalBytes += data.length;
        fileCount += 1;
      }
    } catch (err) {
      await this.remove(hash).catch(() => {});
      throw err;
    }

    const entryFile = this.resolveEntry(hash);
    if (!entryFile) {
      await this.remove(hash).catch(() => {});
      throw new BundleError('no_entry_html');
    }

    return { totalBytes, fileCount, entryFile: normalizeEntryName(entryFile) };
  }
}

export class BundleError extends Error {
  constructor(code) {
    super(code);
    this.name = 'BundleError';
    this.code = code;
  }
}

// Skip OS/zip metadata that should never be served.
function ignoredEntry(rel) {
  if (rel.startsWith('__MACOSX/')) return true;
  const base = rel.split('/').pop();
  return base === '.DS_Store' || base === 'Thumbs.db';
}

// If every entry lives under a single top-level directory, return that
// directory prefix (e.g. "training/") so it can be stripped, putting the
// entry HTML at the bundle root. Otherwise returns ''.
function computeCommonPrefix(names) {
  const meaningful = names.filter((n) => !ignoredEntry(n.replace(/\\/g, '/')));
  if (meaningful.length === 0) return '';
  let prefix = null;
  for (const raw of meaningful) {
    const name = raw.replace(/\\/g, '/');
    const slash = name.indexOf('/');
    if (slash === -1) return '';
    const top = name.slice(0, slash + 1);
    if (prefix === null) prefix = top;
    else if (prefix !== top) return '';
  }
  return prefix || '';
}
