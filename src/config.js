import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

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

function normalizeBasePath(raw) {
  if (raw === undefined || raw === null) return '';
  let s = String(raw).trim();
  if (s === '' || s === '/') return '';
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/\/+$/, '');
  return s;
}

export function loadConfig(overrides = {}) {
  const dataDirRaw = overrides.DATA_DIR ?? str('DATA_DIR', './data');
  const dataDir = path.isAbsolute(dataDirRaw)
    ? dataDirRaw
    : path.resolve(projectRoot, dataDirRaw);

  const basePath = normalizeBasePath(
    overrides.BASE_PATH ?? str('BASE_PATH', ''),
  );

  return {
    port: overrides.PORT ?? int('PORT', 3000),
    publicHost: overrides.PUBLIC_HOST ?? str('PUBLIC_HOST', 'http://localhost:3000'),
    basePath,
    dailyUploadLimit: overrides.DAILY_UPLOAD_LIMIT ?? int('DAILY_UPLOAD_LIMIT', 5),
    maxFileSizeMb: overrides.MAX_FILE_SIZE_MB ?? int('MAX_FILE_SIZE_MB', 50),
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    sitesDir: path.join(dataDir, 'sites'),
    dbPath: path.join(dataDir, 'app.db'),
    projectRoot,
    wecomCorpId: overrides.WECOM_CORPID ?? str('WECOM_CORPID', ''),
    wecomCorpSecret: overrides.WECOM_CORPSECRET ?? str('WECOM_CORPSECRET', ''),
    smtpHost: overrides.SMTP_HOST ?? str('SMTP_HOST', 'smtp.exmail.qq.com'),
    smtpPort: overrides.SMTP_PORT ?? int('SMTP_PORT', 465),
    smtpUser: overrides.SMTP_USER ?? str('SMTP_ACCOUNT', 'noreply@tiangongtech.cn'),
    smtpPass: overrides.SMTP_PASS ?? str('WECOM_CORPSECRET', ''),
    smtpFrom: overrides.SMTP_FROM ?? str('SMTP_ACCOUNT', 'noreply@tiangongtech.cn'),
    tokenSecret: overrides.TOKEN_SECRET ?? str('TOKEN_SECRET', 'change-me-in-production'),
    tokenExpirySeconds: overrides.TOKEN_EXPIRY_SECONDS ?? int('TOKEN_EXPIRY_SECONDS', 86400),
    verificationCodeExpirySeconds: overrides.VERIFICATION_CODE_EXPIRY_SECONDS ?? int('VERIFICATION_CODE_EXPIRY_SECONDS', 600),
  };
}

export const projectPaths = {
  root: projectRoot,
  publicDir: path.join(projectRoot, 'public'),
};
