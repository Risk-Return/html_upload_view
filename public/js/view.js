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
  const tokenGate = $('#token-gate');
  const tokenInput = $('#token-input');
  const tokenSubmit = $('#token-submit');
  const tokenError = $('#token-error');

  let accessToken = '';

  async function checkTokenRequired() {
    try {
      const res = await fetch(`api/uploads/${hash}/token-check`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.requiresToken;
    } catch {
      return false;
    }
  }

  async function loadPreview() {
    const qs = accessToken ? `?token=${encodeURIComponent(accessToken)}` : '';
    iframe.setAttribute('src', `raw/${hash}/${qs}`);
    iframe.addEventListener('load', () => { try { iframe.contentWindow.focus(); } catch(e) {} });
  }

  const requiresToken = await checkTokenRequired();

  if (requiresToken) {
    iframe.style.display = 'none';
    tokenGate.hidden = false;

    tokenSubmit.addEventListener('click', async () => {
      const token = tokenInput.value.trim();
      if (!token) return;
      tokenError.hidden = true;
      const res = await fetch(`raw/${hash}?token=${encodeURIComponent(token)}`, { method: 'GET' });
      if (res.ok) {
        accessToken = token;
        tokenGate.hidden = true;
        iframe.style.display = '';
        loadPreview();
      } else {
        tokenError.hidden = false;
      }
    });

    tokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tokenSubmit.click();
    });
  } else {
    loadPreview();
  }

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'presentation-mode') {
      document.body.classList.toggle('presentation-mode', !!e.data.enabled);
    }
  });

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
