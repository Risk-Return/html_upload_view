// Seeds the examples/training folder as if it were uploaded as a zip bundle.
//
// It generates a hash-named folder under data/sites/, copies the example files
// into it, and records an `uploads` row (kind=bundle, entry_file=index.html)
// labelled to the given email account so it appears in that user's history.
//
// Usage:
//   node scripts/seed-example.js
//   node scripts/seed-example.js --email someone@example.com --src examples/training

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { Db } from '../src/db.js';
import { BundleStore } from '../src/bundle.js';
import { generateHash } from '../src/hash.js';
import { hashPassword } from '../src/auth/crypto.js';

const ENTRY_CANDIDATES = ['index.html', 'main.html'];
const DEFAULT_EMAIL = '32490432@qq.com';
const DEFAULT_PASSWORD = 'changeme123';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') out.email = argv[++i];
    else if (a === '--src') out.src = argv[++i];
  }
  return out;
}

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  let totalBytes = 0;
  let fileCount = 0;
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      const sub = await copyDir(from, to);
      totalBytes += sub.totalBytes;
      fileCount += sub.fileCount;
    } else if (entry.isFile()) {
      await fsp.copyFile(from, to);
      totalBytes += (await fsp.stat(to)).size;
      fileCount += 1;
    }
  }
  return { totalBytes, fileCount };
}

function resolveEntry(dir) {
  for (const candidate of ENTRY_CANDIDATES) {
    try {
      if (fs.statSync(path.join(dir, candidate)).isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email || DEFAULT_EMAIL;

  const config = loadConfig();
  const srcDir = args.src
    ? path.resolve(config.projectRoot, args.src)
    : path.join(config.projectRoot, 'examples', 'training');

  if (!fs.existsSync(srcDir)) {
    console.error(`Source folder not found: ${srcDir}`);
    process.exit(1);
  }

  const db = new Db(config.dbPath);
  const bundles = new BundleStore(config.sitesDir);

  try {
    // Ensure the owning user exists (verified) so the bundle shows in history.
    if (!db.getUser(email)) {
      db.createUser(email, hashPassword(DEFAULT_PASSWORD));
      db.setUserVerified(email);
      console.log(`Created user ${email} with password "${DEFAULT_PASSWORD}".`);
    } else {
      console.log(`User ${email} already exists; leaving credentials unchanged.`);
    }

    // Generate a unique hash-named folder under data/sites/.
    let hash = generateHash();
    while (db.getUpload(hash) || (await bundles.exists(hash))) {
      hash = generateHash();
    }

    const destDir = bundles.dirFor(hash);
    const { totalBytes, fileCount } = await copyDir(srcDir, destDir);

    const entryFile = resolveEntry(destDir);
    if (!entryFile) {
      await bundles.remove(hash).catch(() => {});
      console.error('No index.html or main.html found in the source folder.');
      process.exit(1);
    }

    const ok = db.insertUpload({
      hash,
      originalName: `${path.basename(srcDir)}.zip`,
      sizeBytes: totalBytes,
      ip: 'seed',
      createdAt: Date.now(),
      uploadedBy: email,
      kind: 'bundle',
      entryFile,
    });
    if (!ok) {
      await bundles.remove(hash).catch(() => {});
      console.error('Failed to insert upload row (hash collision).');
      process.exit(1);
    }

    const url = `${config.publicHost}${config.basePath}/view/${hash}`;
    console.log('\nSeeded bundle:');
    console.log(`  hash       : ${hash}`);
    console.log(`  folder     : ${destDir}`);
    console.log(`  files      : ${fileCount} (${totalBytes} bytes)`);
    console.log(`  entry      : ${entryFile}`);
    console.log(`  labelled to: ${email}`);
    console.log(`  view URL   : ${url}\n`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
