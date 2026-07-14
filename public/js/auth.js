import { I18n } from './i18n.js';

const i18n = new I18n();

const els = {};

function $(sel) { return document.querySelector(sel); }

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('is-show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove('is-show'), 1800);
}

function setLoginError(msg) {
  if (!msg) {
    els.loginError.hidden = true;
    return;
  }
  els.loginError.hidden = false;
  els.loginError.querySelector('.msg').textContent = msg;
}

function setRegisterError(msg) {
  if (!msg) {
    els.registerError.hidden = true;
    return;
  }
  els.registerError.hidden = false;
  els.registerError.querySelector('.msg').textContent = msg;
}

function setRegisterInfo(msg) {
  if (!msg) {
    els.registerInfo.hidden = true;
    return;
  }
  els.registerInfo.hidden = false;
  els.registerInfo.querySelector('.msg').textContent = msg;
}

function getRedirectUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('redirect') || './';
}

function showRegister() {
  els.loginForm.hidden = true;
  els.registerForm.hidden = false;
  setLoginError('');
}

function showLogin() {
  els.registerForm.hidden = true;
  els.resetForm.hidden = true;
  els.loginForm.hidden = false;
  setRegisterError('');
  setResetError('');
}

function showReset() {
  els.loginForm.hidden = true;
  els.registerForm.hidden = true;
  els.resetForm.hidden = false;
  setLoginError('');
  setRegisterError('');
  setResetError('');
}

let sendCodeTimer = 0;

async function sendCode() {
  const email = els.regEmail.value.trim();
  if (!email) {
    setRegisterError(i18n.t('auth.errors.emailRequired'));
    return;
  }

  els.sendCodeBtn.disabled = true;
  setRegisterError('');
  setRegisterInfo('');

  try {
    const res = await fetch('api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const key = data.error || 'unknown';
      setRegisterError(i18n.t(`auth.errors.${key}`) || i18n.t('auth.errors.unknown'));
      els.sendCodeBtn.disabled = false;
      return;
    }

    setRegisterInfo(i18n.t('auth.codeSent'));
    let remaining = 60;
    const updateBtn = () => {
      els.sendCodeBtn.textContent = `${remaining}s`;
      if (remaining > 0) {
        remaining--;
        sendCodeTimer = setTimeout(updateBtn, 1000);
      } else {
        els.sendCodeBtn.textContent = i18n.t('auth.sendCode');
        els.sendCodeBtn.disabled = false;
      }
    };
    updateBtn();
  } catch {
    setRegisterError(i18n.t('errors.network'));
    els.sendCodeBtn.disabled = false;
  }
}

async function register() {
  const email = els.regEmail.value.trim();
  const code = els.regCode.value.trim();
  const password = els.regPassword.value;

  if (!email || !code || !password) {
    setRegisterError(i18n.t('auth.errors.allFieldsRequired'));
    return;
  }
  if (password.length < 6) {
    setRegisterError(i18n.t('auth.errors.passwordTooShort'));
    return;
  }

  els.registerSubmit.disabled = true;
  setRegisterError('');

  try {
    const res = await fetch('api/auth/verify-and-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, password }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const key = data.error || 'unknown';
      setRegisterError(i18n.t(`auth.errors.${key}`) || i18n.t('auth.errors.unknown'));
      els.registerSubmit.disabled = false;
      return;
    }

    window.location.href = getRedirectUrl();
  } catch {
    setRegisterError(i18n.t('errors.network'));
    els.registerSubmit.disabled = false;
  }
}

function setResetError(msg) {
  if (!msg) {
    els.resetError.hidden = true;
    return;
  }
  els.resetError.hidden = false;
  els.resetError.querySelector('.msg').textContent = msg;
}

function setResetInfo(msg) {
  if (!msg) {
    els.resetInfo.hidden = true;
    return;
  }
  els.resetInfo.hidden = false;
  els.resetInfo.querySelector('.msg').textContent = msg;
}

let resetTimer = 0;

async function sendResetCode() {
  const email = els.resetEmail.value.trim();
  if (!email) {
    setResetError(i18n.t('auth.errors.emailRequired'));
    return;
  }

  els.sendResetCodeBtn.disabled = true;
  setResetError('');
  setResetInfo('');

  try {
    const res = await fetch('api/auth/send-reset-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const key = data.error || 'unknown';
      setResetError(i18n.t(`auth.errors.${key}`) || i18n.t('auth.errors.unknown'));
      els.sendResetCodeBtn.disabled = false;
      return;
    }

    setResetInfo(i18n.t('auth.codeSent'));
    let remaining = 60;
    const updateBtn = () => {
      els.sendResetCodeBtn.textContent = `${remaining}s`;
      if (remaining > 0) {
        remaining--;
        resetTimer = setTimeout(updateBtn, 1000);
      } else {
        els.sendResetCodeBtn.textContent = i18n.t('auth.sendCode');
        els.sendResetCodeBtn.disabled = false;
      }
    };
    updateBtn();
  } catch {
    setResetError(i18n.t('errors.network'));
    els.sendResetCodeBtn.disabled = false;
  }
}

async function resetPassword() {
  const email = els.resetEmail.value.trim();
  const code = els.resetCode.value.trim();
  const password = els.resetPassword.value;

  if (!email || !code || !password) {
    setResetError(i18n.t('auth.errors.allFieldsRequired'));
    return;
  }
  if (password.length < 6) {
    setResetError(i18n.t('auth.errors.passwordTooShort'));
    return;
  }

  els.resetSubmit.disabled = true;
  setResetError('');

  try {
    const res = await fetch('api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, password }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const key = data.error || 'unknown';
      setResetError(i18n.t(`auth.errors.${key}`) || i18n.t('auth.errors.unknown'));
      els.resetSubmit.disabled = false;
      return;
    }

    alert(i18n.t('auth.passwordResetOk'));
    showLogin();
  } catch {
    setResetError(i18n.t('errors.network'));
    els.resetSubmit.disabled = false;
  }
}

async function login() {
  const email = els.loginEmail.value.trim();
  const password = els.loginPassword.value;

  if (!email || !password) {
    setLoginError(i18n.t('auth.errors.emailPasswordRequired'));
    return;
  }

  els.loginSubmit.disabled = true;
  setLoginError('');

  try {
    const res = await fetch('api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const key = data.error || 'unknown';
      setLoginError(i18n.t(`auth.errors.${key}`) || i18n.t('auth.errors.unknown'));
      els.loginSubmit.disabled = false;
      return;
    }

    window.location.href = getRedirectUrl();
  } catch {
    setLoginError(i18n.t('errors.network'));
    els.loginSubmit.disabled = false;
  }
}

async function init() {
  els.loginForm = $('#login-form');
  els.registerForm = $('#register-form');
  els.loginEmail = $('#login-email');
  els.loginPassword = $('#login-password');
  els.loginSubmit = $('#login-submit');
  els.loginError = $('#login-error');
  els.regEmail = $('#reg-email');
  els.regCode = $('#reg-code');
  els.regPassword = $('#reg-password');
  els.registerSubmit = $('#register-submit');
  els.registerError = $('#register-error');
  els.registerInfo = $('#register-info');
  els.sendCodeBtn = $('#send-code-btn');
  els.toast = $('#toast');
  els.langToggle = $('#lang-toggle');
  els.showRegBtn = $('#show-register');
  els.showLogBtn = $('#show-login');
  els.resetForm = $('#reset-form');
  els.resetEmail = $('#reset-email');
  els.resetCode = $('#reset-code');
  els.resetPassword = $('#reset-password');
  els.resetSubmit = $('#reset-submit');
  els.resetError = $('#reset-error');
  els.resetInfo = $('#reset-info');
  els.sendResetCodeBtn = $('#send-reset-code-btn');
  els.showResetBtn = $('#show-reset');
  els.showLoginFromResetBtn = $('#show-login-from-reset');

  try {
    await i18n.init();
  } catch (err) {
    console.error('i18n init failed:', err);
  }

  if (els.loginSubmit) els.loginSubmit.addEventListener('click', login);
  if (els.registerSubmit) els.registerSubmit.addEventListener('click', register);
  if (els.sendCodeBtn) els.sendCodeBtn.addEventListener('click', sendCode);
  if (els.resetSubmit) els.resetSubmit.addEventListener('click', resetPassword);
  if (els.sendResetCodeBtn) els.sendResetCodeBtn.addEventListener('click', sendResetCode);
  if (els.showRegBtn) els.showRegBtn.addEventListener('click', (e) => { e.preventDefault(); showRegister(); });
  if (els.showLogBtn) els.showLogBtn.addEventListener('click', (e) => { e.preventDefault(); showLogin(); });
  if (els.showResetBtn) els.showResetBtn.addEventListener('click', (e) => { e.preventDefault(); showReset(); });
  if (els.showLoginFromResetBtn) els.showLoginFromResetBtn.addEventListener('click', (e) => { e.preventDefault(); showLogin(); });
  if (els.langToggle) els.langToggle.addEventListener('click', () => i18n.toggle());
  if (els.loginPassword) els.loginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
}

init().catch((err) => console.error('auth init failed:', err));
