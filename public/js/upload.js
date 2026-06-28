import { I18n } from './i18n.js';

const i18n = new I18n();

const ACCEPT_RE = /\.(html?|zip)$/i;

const state = {
  files: [],
  uploading: false,
  tokens: [],
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
  const valid = incoming.filter((f) => ACCEPT_RE.test(f.name));
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
  if (state.tokens.length > 0) {
    fd.append('access_tokens', JSON.stringify(state.tokens));
  }

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
  state.tokens = [];
  renderFiles();
  renderTokenList();
  loadHistory();
}

function renderTokenList() {
  const list = els.tokenList;
  if (!list) return;
  list.innerHTML = '';
  state.tokens.forEach((tok, idx) => {
    const li = document.createElement('li');
    li.className = 'token-item';
    li.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card)';
    const tokenSpan = document.createElement('span');
    tokenSpan.style.cssText = 'flex:1;font-family:var(--font-mono);font-size:13px;color:var(--text)';
    tokenSpan.textContent = tok.token;
    const maxSpan = document.createElement('span');
    maxSpan.style.cssText = 'font-size:12px;color:var(--text-soft);white-space:nowrap';
    maxSpan.textContent = tok.maxUses === -1 ? i18n.t('tokens.unlimited') : `${i18n.t('tokens.maxVisits')}: ${tok.maxUses}`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-btn';
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    removeBtn.addEventListener('click', () => {
      state.tokens.splice(idx, 1);
      renderTokenList();
    });
    li.appendChild(tokenSpan);
    li.appendChild(maxSpan);
    li.appendChild(removeBtn);
    list.appendChild(li);
  });
}

function addTokenEntry() {
  const token = prompt(i18n.t('tokens.enterToken'));
  if (!token || !token.trim()) return;
  const maxStr = prompt(i18n.t('tokens.enterMax'), '-1');
  const maxUses = parseInt(maxStr, 10);
  if (isNaN(maxUses)) return;
  state.tokens.push({ token: token.trim(), maxUses });
  renderTokenList();
}

let modalState = { hash: null, fileName: null };

async function openTokenModal(hash, fileName) {
  modalState = { hash, fileName };
  els.tokenModal.hidden = false;
  els.tokenModalFile.textContent = fileName;
  els.tokenModalInput.value = '';
  els.tokenModalMax.value = '-1';
  await loadModalTokens();
}

async function loadModalTokens() {
  const list = els.tokenModalList;
  list.innerHTML = '';
  try {
    const res = await fetch(`api/uploads/${modalState.hash}/tokens`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.tokens || data.tokens.length === 0) {
      const li = document.createElement('li');
      li.style.cssText = 'font-size:13px;color:var(--text-soft);padding:8px 0';
      li.textContent = i18n.t('tokens.noTokens');
      list.appendChild(li);
      return;
    }
    data.tokens.forEach((tok) => {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card)';
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      const tokenDiv = document.createElement('div');
      tokenDiv.style.cssText = 'font-family:var(--font-mono);font-size:13px;color:var(--text)';
      tokenDiv.textContent = tok.token;
      const usageDiv = document.createElement('div');
      usageDiv.style.cssText = 'font-size:11px;color:var(--text-soft)';
      const maxLabel = tok.maxUses === -1 ? i18n.t('tokens.unlimited') : `${tok.maxUses}`;
      usageDiv.textContent = `${i18n.t('tokens.used')}: ${tok.usedCount} / ${maxLabel}`;
      info.appendChild(tokenDiv);
      info.appendChild(usageDiv);
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'icon-btn';
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
      delBtn.addEventListener('click', async () => {
        await fetch(`api/uploads/${modalState.hash}/tokens/${tok.id}`, { method: 'DELETE' });
        loadModalTokens();
      });
      li.appendChild(info);
      li.appendChild(delBtn);
      list.appendChild(li);
    });
  } catch {
    // silent
  }
}

async function modalAddToken() {
  const token = els.tokenModalInput.value.trim();
  if (!token) return;
  const maxUses = parseInt(els.tokenModalMax.value, 10);
  if (isNaN(maxUses)) return;
  const res = await fetch(`api/uploads/${modalState.hash}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, maxUses }),
  });
  if (res.ok) {
    els.tokenModalInput.value = '';
    els.tokenModalMax.value = '-1';
    loadModalTokens();
  } else {
    const data = await res.json().catch(() => ({}));
    showToast(i18n.t(`errors.${data.error}`, data) || i18n.t('errors.storage_failure'));
  }
}

let statsModalState = { hash: null, fileName: null };

async function openStatsModal(hash, fileName) {
  statsModalState = { hash, fileName };
  els.statsModal.hidden = false;
  els.statsModalFile.textContent = fileName;
  await loadStats();
}

function formatVisitTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadStats() {
  const tbody = els.statsTbody;
  const empty = els.statsEmpty;
  const table = els.statsTable;
  tbody.innerHTML = '';
  try {
    const res = await fetch(`api/uploads/${statsModalState.hash}/stats`);
    if (!res.ok) {
      empty.hidden = false;
      table.hidden = true;
      return;
    }
    const data = await res.json();
    els.statsTotal.textContent = data.totalVisits;
    els.statsUnique.textContent = data.uniqueIps;
    if (!data.byIp || data.byIp.length === 0) {
      empty.hidden = false;
      table.hidden = true;
      return;
    }
    empty.hidden = true;
    table.hidden = false;
    data.byIp.forEach((row) => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border)';
      const tdIp = document.createElement('td');
      tdIp.style.cssText = 'padding:8px 4px;font-family:var(--font-mono);font-size:12px;color:var(--text)';
      tdIp.textContent = row.ip;
      const tdVisits = document.createElement('td');
      tdVisits.style.cssText = 'padding:8px 4px;text-align:right;font-weight:600;color:var(--accent)';
      tdVisits.textContent = row.visitCount;
      const tdFirst = document.createElement('td');
      tdFirst.style.cssText = 'padding:8px 4px;text-align:right;font-size:12px;color:var(--text-soft)';
      tdFirst.textContent = formatVisitTime(row.firstVisit);
      const tdLast = document.createElement('td');
      tdLast.style.cssText = 'padding:8px 4px;text-align:right;font-size:12px;color:var(--text-soft)';
      tdLast.textContent = formatVisitTime(row.lastVisit);
      tr.appendChild(tdIp);
      tr.appendChild(tdVisits);
      tr.appendChild(tdFirst);
      tr.appendChild(tdLast);
      tbody.appendChild(tr);
    });
  } catch {
    empty.hidden = false;
    table.hidden = true;
  }
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
      <div class="hi-url"></div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button type="button" class="hi-token-btn" title="${i18n.t('tokens.manageTokens')}" style="font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text-soft);cursor:pointer;display:inline-flex;align-items:center;gap:4px">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;stroke:currentColor"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span data-i18n="tokens.manageTokens">Tokens</span>
        </button>
        <button type="button" class="hi-stats-btn" title="${i18n.t('stats.manageStats')}" style="font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text-soft);cursor:pointer;display:inline-flex;align-items:center;gap:4px">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;stroke:currentColor"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          <span data-i18n="stats.manageStats">Stats</span>
        </button>
      </div>`;
    li.querySelector('.hi-name').textContent = item.originalName;
    li.querySelector('.hi-size').textContent = formatBytes(item.sizeBytes);
    li.querySelector('.hi-time').textContent = timeAgo(item.createdAt);
    li.querySelector('.hi-url').textContent = item.url;
    li.querySelector('.hi-url').addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(item.url);
    });
    li.querySelector('.hi-token-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const hashMatch = item.url.match(/\/view\/([0-9A-Za-z]{12})/);
      if (hashMatch) openTokenModal(hashMatch[1], item.originalName);
    });
    li.querySelector('.hi-stats-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const hashMatch = item.url.match(/\/view\/([0-9A-Za-z]{12})/);
      if (hashMatch) openStatsModal(hashMatch[1], item.originalName);
    });
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
  els.tokenToggle = $('#token-toggle');
  els.tokenBody = $('#token-body');
  els.tokenChevron = $('#token-chevron');
  els.tokenList = $('#token-list');
  els.tokenAddBtn = $('#token-add-btn');
  els.tokenModal = $('#token-modal');
  els.tokenModalClose = $('#token-modal-close');
  els.tokenModalFile = $('#token-modal-file');
  els.tokenModalList = $('#token-modal-list');
  els.tokenModalInput = $('#token-modal-input');
  els.tokenModalMax = $('#token-modal-max');
  els.tokenModalAdd = $('#token-modal-add');
  els.statsModal = $('#stats-modal');
  els.statsModalClose = $('#stats-modal-close');
  els.statsModalFile = $('#stats-modal-file');
  els.statsTotal = $('#stats-total');
  els.statsUnique = $('#stats-unique');
  els.statsEmpty = $('#stats-empty');
  els.statsTable = $('#stats-table');
  els.statsTbody = $('#stats-tbody');

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
    renderTokenList();
    if (els.error && !els.error.hidden) {
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

  if (els.tokenToggle) {
    els.tokenToggle.addEventListener('click', () => {
      els.tokenBody.hidden = !els.tokenBody.hidden;
      if (els.tokenChevron) {
        els.tokenChevron.style.transform = els.tokenBody.hidden ? '' : 'rotate(180deg)';
      }
    });
  }
  if (els.tokenAddBtn) {
    els.tokenAddBtn.addEventListener('click', addTokenEntry);
  }
  if (els.tokenModalClose) {
    els.tokenModalClose.addEventListener('click', () => { els.tokenModal.hidden = true; });
  }
  if (els.tokenModal) {
    els.tokenModal.addEventListener('click', (e) => {
      if (e.target === els.tokenModal) els.tokenModal.hidden = true;
    });
  }
  if (els.tokenModalAdd) {
    els.tokenModalAdd.addEventListener('click', modalAddToken);
  }
  if (els.tokenModalInput) {
    els.tokenModalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') modalAddToken();
    });
  }
  if (els.statsModalClose) {
    els.statsModalClose.addEventListener('click', () => { els.statsModal.hidden = true; });
  }
  if (els.statsModal) {
    els.statsModal.addEventListener('click', (e) => {
      if (e.target === els.statsModal) els.statsModal.hidden = true;
    });
  }

  renderFiles();
}

init();
