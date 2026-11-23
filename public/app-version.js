/**
 * Подпись версии у логотипа RetKit: «v0.2.0 · Heroku · d2de8a6».
 * Одинаковая сборка (7 знаков) = одинаковый код на Heroku и на localhost.
 */
(function () {
  'use strict';
  const anchor = document.querySelector('.app-logo .app-name') || document.querySelector('.topbar .brand');
  if (!anchor || document.getElementById('appVersionLabel')) return;
  fetch('/api/version', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((v) => {
      if (!v || !v.version) return;
      const label = document.createElement('span');
      label.id = 'appVersionLabel';
      label.className = `app-version ${v.env === 'heroku' ? 'is-heroku' : 'is-local'}`;
      label.textContent = `v${v.version} · ${v.env === 'heroku' ? 'Heroku' : 'localhost'} · ${v.build}`;
      label.title = [
        `Версия студии ${v.version}`,
        `Где: ${v.env === 'heroku' ? 'Heroku' : 'своя машина (localhost)'}`,
        `Сборка: ${v.build} — совпадает у одинакового кода`,
        v.commit ? `Коммит: ${v.commit}` : 'Коммит: не известен',
        `Сервер запущен: ${new Date(v.startedAt).toLocaleString()}`,
      ].join('\n');
      anchor.insertAdjacentElement('afterend', label);
    })
    .catch(() => {});
})();
