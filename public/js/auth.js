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

function showRegister() {
  els.loginForm.hidden = true;
  els.registerForm.hidden = false;
  setLoginError('');
}

function showLogin() {
  els.registerForm.hidden = true;
  els.loginForm.hidden = false;
  setRegisterError('');
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

    window.location.href = './';
  } catch {
    setRegisterError(i18n.t('errors.network'));
    els.registerSubmit.disabled = false;
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

    window.location.href = './';
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

  await i18n.init();

  els.loginSubmit.addEventListener('click', login);
  els.registerSubmit.addEventListener('click', register);
  els.sendCodeBtn.addEventListener('click', sendCode);
  $('#show-register').addEventListener('click', (e) => { e.preventDefault(); showRegister(); });
  $('#show-login').addEventListener('click', (e) => { e.preventDefault(); showLogin(); });
  els.langToggle.addEventListener('click', () => i18n.toggle());

  els.loginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
}

init();
