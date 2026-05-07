import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isValidHash } from './hash.js';

export class Storage {
  constructor(uploadsDir) {
    if (!uploadsDir) throw new Error('uploadsDir is required');
    this.uploadsDir = uploadsDir;
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  pathFor(hash) {
    if (!isValidHash(hash)) {
      throw new Error(`Invalid hash: ${hash}`);
    }
    return path.join(this.uploadsDir, `${hash}.html`);
  }

  async exists(hash) {
    if (!isValidHash(hash)) return false;
    try {
      await fsp.access(this.pathFor(hash), fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async saveHtml(hash, data) {
    const finalPath = this.pathFor(hash);
    const tmpPath = path.join(
      this.uploadsDir,
      `.${hash}.${crypto.randomBytes(4).toString('hex')}.tmp`,
    );
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await fsp.writeFile(tmpPath, buf);
    try {
      await fsp.rename(tmpPath, finalPath);
    } catch (err) {
      await fsp.unlink(tmpPath).catch(() => {});
      throw err;
    }
    return finalPath;
  }

  async readHtml(hash) {
    return fsp.readFile(this.pathFor(hash));
  }

  async deleteHtml(hash) {
    try {
      await fsp.unlink(this.pathFor(hash));
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }
}
