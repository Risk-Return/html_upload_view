import { I18n } from './i18n.js';

const i18n = new I18n();

const HTML_RE = /\.html?$/i;

const state = {
  files: [],
  uploading: false,
};

const els = {};

function $(sel) { return document.querySelector(sel); }

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('is-show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove('is-show'), 1800);
}

function setError(message) {
  if (!message) {
    els.error.hidden = true;
    els.error.querySelector('.msg').textContent = '';
    return;
  }
  els.error.hidden = false;
  els.error.querySelector('.msg').textContent = message;
}

function renderFiles() {
  els.fileList.innerHTML = '';
  if (state.files.length === 0) {
    els.filesSection.hidden = true;
    els.submitBtn.disabled = true;
    return;
  }
  els.filesSection.hidden = false;
  els.submitBtn.disabled = state.uploading;

  state.files.forEach((file, idx) => {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.innerHTML = `
      <span class="file-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>
      </span>
      <div class="file-meta">
        <div class="file-name"></div>
        <div class="file-size"></div>
      </div>
      <button type="button" class="icon-btn" data-action="remove" data-idx="${idx}" aria-label="${i18n.t('upload.remove')}" title="${i18n.t('upload.remove')}">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;
    li.querySelector('.file-name').textContent = file.name;
    li.querySelector('.file-size').textContent = formatBytes(file.size);
    els.fileList.appendChild(li);
  });
}

function addFiles(fileList) {
  setError('');
  const incoming = Array.from(fileList || []);
  const valid = incoming.filter((f) => HTML_RE.test(f.name));
  if (valid.length < incoming.length) {
    setError(i18n.t('errors.invalid_file_type'));
  }
  state.files = state.files.concat(valid);
  renderFiles();
}

function clearAll() {
  state.files = [];
  setError('');
  renderFiles();
  els.results.hidden = true;
}

function buildResultItem(item) {
  const li = document.createElement('li');
  li.className = 'result-item';
  li.innerHTML = `
    <div class="url-block">
      <div class="original-name"></div>
      <div class="url"></div>
    </div>
    <button type="button" class="icon-btn" data-action="copy" aria-label="${i18n.t('results.copy')}" title="${i18n.t('results.copy')}">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
    </button>
    <a class="icon-btn" data-action="open" target="_blank" rel="noopener" aria-label="${i18n.t('results.open')}" title="${i18n.t('results.open')}">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    </a>`;
  li.querySelector('.original-name').textContent = item.originalName;
  li.querySelector('.url').textContent = item.url;
  li.querySelector('[data-action="open"]').setAttribute('href', item.url);
  li.querySelector('[data-action="copy"]').addEventListener('click', () => copyToClipboard(item.url));
  return li;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(i18n.t('results.copied'));
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast(i18n.t('results.copied')); }
    finally { ta.remove(); }
  }
}

async function submit() {
  if (state.files.length === 0 || state.uploading) return;
  state.uploading = true;
  setError('');
  els.submitBtn.disabled = true;
  els.submitBtn.querySelector('.label').textContent = i18n.t('upload.submitting');

  const fd = new FormData();
  for (const f of state.files) fd.append('files', f, f.name);

  try {
    const res = await fetch('api/upload', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const key = data.error || 'storage_failure';
      const msg = i18n.t(`errors.${key}`, data) || i18n.t('errors.storage_failure');
      setError(msg);
      return;
    }
    renderResults(data);
  } catch {
    setError(i18n.t('errors.network'));
  } finally {
    state.uploading = false;
    els.submitBtn.disabled = state.files.length === 0;
    els.submitBtn.querySelector('.label').textContent = i18n.t('upload.submit');
  }
}

function renderResults(data) {
  els.results.hidden = false;
  els.resultList.innerHTML = '';
  for (const item of data.uploads) {
    els.resultList.appendChild(buildResultItem(item));
  }
  state.files = [];
  renderFiles();
  loadHistory();
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

async function loadHistory() {
  try {
    const res = await fetch('api/uploads');
    if (!res.ok) return;
    const data = await res.json();
    renderHistory(data);
  } catch {
    // silent
  }
}

function renderHistory(items) {
  if (!els.historyList) return;

  if (!items || items.length === 0) {
    els.historyLoading.hidden = true;
    els.historyList.hidden = true;
    els.historyEmpty.hidden = false;
    return;
  }

  els.historyLoading.hidden = true;
  els.historyEmpty.hidden = true;
  els.historyList.hidden = false;
  els.historyList.innerHTML = '';

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `
      <div class="hi-name"></div>
      <div class="hi-meta">
        <span class="hi-size"></span>
        <span class="hi-time"></span>
      </div>
      <div class="hi-url"></div>`;
    li.querySelector('.hi-name').textContent = item.originalName;
    li.querySelector('.hi-size').textContent = formatBytes(item.sizeBytes);
    li.querySelector('.hi-time').textContent = timeAgo(item.createdAt);
    li.querySelector('.hi-url').textContent = item.url;
    li.addEventListener('click', () => copyToClipboard(item.url));
    els.historyList.appendChild(li);
  });
}

function bindDropzone() {
  const dz = els.dropzone;
  ['dragenter', 'dragover'].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.add('is-active');
    }),
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === 'dragleave' && e.target !== dz) return;
      dz.classList.remove('is-active');
    }),
  );
  dz.addEventListener('drop', (e) => addFiles(e.dataTransfer?.files));
  els.fileInput.addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  });
}

async function init() {
  els.dropzone = $('#dropzone');
  els.fileInput = $('#file-input');
  els.fileList = $('#file-list');
  els.filesSection = $('#files-section');
  els.submitBtn = $('#submit-btn');
  els.clearBtn = $('#clear-btn');
  els.error = $('#error');
  els.results = $('#results');
  els.resultList = $('#result-list');
  els.toast = $('#toast');
  els.langToggle = $('#lang-toggle');
  els.userEmail = $('#user-email');
  els.logoutBtn = $('#logout-btn');
  els.historyList = $('#history-list');
  els.historyLoading = $('#history-loading');
  els.historyEmpty = $('#history-empty');

  await i18n.init();

  try {
    const meRes = await fetch('api/auth/me');
    if (!meRes.ok) {
      window.location.href = 'login';
      return;
    }
    const meData = await meRes.json();
    if (els.userEmail) els.userEmail.textContent = meData.email;
  } catch {
    window.location.href = 'login';
    return;
  }

  loadHistory();

  i18n.onChange(() => {
    renderFiles();
    if (els.error && !els.error.hidden) {
      // re-translate by clearing — caller would need to re-trigger; safest: clear
      setError('');
    }
  });

  bindDropzone();
  els.submitBtn.addEventListener('click', submit);
  els.clearBtn.addEventListener('click', clearAll);
  els.fileList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove"]');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    state.files.splice(idx, 1);
    renderFiles();
  });
  els.langToggle.addEventListener('click', () => i18n.toggle());
  els.logoutBtn.addEventListener('click', async () => {
    await fetch('api/auth/logout', { method: 'POST' });
    window.location.href = 'login';
  });

  renderFiles();
}

init();
