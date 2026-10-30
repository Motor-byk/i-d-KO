// Tiny element builder: h('div.card', { onclick }, child, 'text', ...)
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    }
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false && value != null) el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

const ERRORS = {
  ROOM_NOT_FOUND: 'No room with that code.',
  ROOM_LOCKED: 'That match already started.',
  ROOM_FULL: 'Room is full (10 players).',
  BAD_NICKNAME: 'Pick a nickname.',
  NICKNAME_TAKEN: 'Someone in that room already has that name.',
  RATE_LIMITED: 'Too many attempts. Wait a minute.',
  BAD_OPTION: 'Type an option first.',
  TOO_MANY_OPTIONS: 'Max 10 options.',
  DUPLICATE_OPTION: 'That option is already in.',
  NEED_TWO_TEAMS: 'Need players on at least two options.',
  NOT_HOST: 'Only the host can do that.',
  TIMEOUT: 'Server did not answer. Check your connection.',
  OFFLINE: 'You are offline. Reconnecting…',
  SERVER_FULL: 'Server is busy. Try again in a bit.',
};

export const errorText = (code) => ERRORS[code] || `Something went wrong (${code}).`;
