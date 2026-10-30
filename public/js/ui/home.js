import { ROOM } from '../../shared/constants.js';
import { h } from './dom.js';

// onSubmit({ nickname, code }) — code null means create a new room.
export function homeScreen({ onSubmit, initialCode = '', error = '' }) {
  const nickname = h('input', {
    placeholder: 'Your nickname',
    maxlength: ROOM.MAX_NICKNAME_LENGTH,
    autocomplete: 'nickname',
    value: localStorageGet('idko-nickname'),
  });
  const code = h('input.code-input', {
    placeholder: 'CODE',
    maxlength: ROOM.CODE_LENGTH,
    autocapitalize: 'characters',
    autocomplete: 'off',
    value: initialCode,
    oninput: (e) => { e.target.value = e.target.value.toUpperCase(); },
  });
  const status = h('p.error', {}, error);

  const submit = (withCode) => {
    localStorageSet('idko-nickname', nickname.value.trim());
    onSubmit({ nickname: nickname.value, code: withCode ? code.value.trim() : null });
  };

  return {
    el: h('main.screen.home', {},
      h('h1.logo', {}, 'i-d-', h('span', {}, 'KO')),
      h('p.tagline', {}, "Can't decide? Fight about it."),
      nickname,
      h('button.primary', { onclick: () => submit(false) }, 'Create room'),
      h('div.or', {}, 'or join one'),
      h('div.row', {}, code, h('button', { onclick: () => submit(true) }, 'Join')),
      status,
    ),
    setError: (msg) => { status.textContent = msg; },
  };
}

function localStorageGet(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

function localStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
