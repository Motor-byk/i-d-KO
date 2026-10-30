import { ROOM } from '../../shared/constants.js';
import { h } from './dom.js';

// onSubmit({ nickname, code }) returns a promise; code null means create a new room.
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
  const createBtn = h('button.primary', { onclick: () => submit(false) }, 'Create room');
  const joinBtn = h('button', { onclick: () => submit(true) }, 'Join');

  async function submit(join) {
    if (join && !code.value.trim()) {
      status.textContent = 'Enter a room code.';
      return;
    }
    localStorageSet('idko-nickname', nickname.value.trim());
    createBtn.disabled = joinBtn.disabled = true;
    try {
      await onSubmit({ nickname: nickname.value, code: join ? code.value.trim() : null });
    } finally {
      createBtn.disabled = joinBtn.disabled = false;
    }
  }

  return {
    kind: 'home',
    el: h('main.screen.home', {},
      h('h1.logo', {}, 'i-d-', h('span', {}, 'KO')),
      h('p.tagline', {}, "Can't decide? Fight about it."),
      nickname,
      createBtn,
      h('div.or', {}, 'or join one'),
      h('div.row', {}, code, joinBtn),
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
