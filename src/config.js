import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Invalid integer for env ${name}: ${raw}`);
  }
  return n;
}

function str(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export function loadConfig(overrides = {}) {
  const dataDirRaw = overrides.DATA_DIR ?? str('DATA_DIR', './data');
  const dataDir = path.isAbsolute(dataDirRaw)
    ? dataDirRaw
    : path.resolve(projectRoot, dataDirRaw);

  return {
    port: overrides.PORT ?? int('PORT', 3000),
    publicHost: overrides.PUBLIC_HOST ?? str('PUBLIC_HOST', 'http://localhost:3000'),
    dailyUploadLimit: overrides.DAILY_UPLOAD_LIMIT ?? int('DAILY_UPLOAD_LIMIT', 5),
    maxFileSizeMb: overrides.MAX_FILE_SIZE_MB ?? int('MAX_FILE_SIZE_MB', 5),
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    dbPath: path.join(dataDir, 'app.db'),
    projectRoot,
  };
}

export const projectPaths = {
  root: projectRoot,
  publicDir: path.join(projectRoot, 'public'),
};
