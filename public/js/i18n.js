const SUPPORTED = ['en', 'zh'];
const STORAGE_KEY = 'huv.lang';

function detectInitialLang() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && SUPPORTED.includes(saved)) return saved;
  const nav = (navigator.language || 'en').toLowerCase();
  if (nav.startsWith('zh')) return 'zh';
  return 'en';
}

async function loadLocale(lang) {
  const base = document.querySelector('base')?.getAttribute('href') || '/';
  const url = `${base}static/locales/${lang}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load locale ${lang}`);
  return res.json();
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

function format(template, vars) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));
}

export class I18n {
  constructor() {
    this.lang = detectInitialLang();
    this.dict = {};
    this.listeners = new Set();
  }

  async init() {
    this.dict = await loadLocale(this.lang);
    document.documentElement.lang = this.lang === 'zh' ? 'zh-CN' : 'en';
    this.apply();
  }

  async setLang(lang) {
    if (!SUPPORTED.includes(lang) || lang === this.lang) return;
    this.lang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    this.dict = await loadLocale(lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    this.apply();
    for (const fn of this.listeners) fn(lang);
  }

  toggle() {
    return this.setLang(this.lang === 'en' ? 'zh' : 'en');
  }

  t(key, vars) {
    const v = getByPath(this.dict, key);
    return format(v ?? key, vars);
  }

  apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const vars = el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : undefined;
      el.textContent = this.t(key, vars);
    });
    root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      const spec = el.getAttribute('data-i18n-attr');
      spec.split(',').forEach((pair) => {
        const [attr, key] = pair.split(':').map((s) => s.trim());
        if (attr && key) el.setAttribute(attr, this.t(key));
      });
    });
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
