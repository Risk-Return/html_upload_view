import { I18n } from './i18n.js';

const i18n = new I18n();

function $(s) { return document.querySelector(s); }

function showToast(toast, msg) {
  toast.textContent = msg;
  toast.classList.add('is-show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('is-show'), 1800);
}

async function copyToClipboard(text, toast) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(toast, i18n.t('view.copied'));
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast(toast, i18n.t('view.copied')); }
    finally { ta.remove(); }
  }
}

async function init() {
  await i18n.init();

  const match = window.location.pathname.match(/\/view\/([0-9A-Za-z]{12})\/?$/);
  if (!match) {
    document.body.innerHTML = '<p style="padding:24px;font-family:system-ui">404</p>';
    return;
  }
  const hash = match[1];
  const iframe = $('#preview');
  iframe.setAttribute('src', `raw/${hash}/`);

  const fullUrl = window.location.href;
  const urlPill = $('#url-pill');
  if (urlPill) urlPill.textContent = fullUrl;

  const copyBtn = $('#copy-btn');
  const toast = $('#toast');
  if (copyBtn && toast) {
    copyBtn.addEventListener('click', () => copyToClipboard(fullUrl, toast));
  }

  const langToggle = $('#lang-toggle');
  if (langToggle) langToggle.addEventListener('click', () => i18n.toggle());
}

init();
