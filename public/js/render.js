import { ARENA, PLAYER, RENDER } from '../shared/constants.js';

const COLORS = {
  void: '#0d0e12',
  floor: '#1d1f27',
  grid: '#252833',
  wall: '#3a3e4d',
  pillar: '#3a3e4d',
  pillarTop: '#4a4f62',
  hpBack: 'rgba(0, 0, 0, 0.55)',
  hp: '#06d6a0',
  hpLow: '#ef476f',
  name: '#f2f2f5',
  me: '#ffffff',
};

const GRID = 100;
const HP_BAR = { w: PLAYER.RADIUS * 2, h: 6, gap: 10 };

// Dark text on light team colors, light text on dark ones.
function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#15161c' : '#ffffff';
}

// Canvas renderer. draw(view) with view = { fighters: [{ id, x, y, aim, hp, maxHp, alive,
// color, label, nickname }], meId, followId }. Camera follows followId, or fits the arena if null.
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  const labelFits = new Map(); // label -> { size, text }, measured once per label
  let cam = null; // camera used for the last frame, for toWorld()

  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  };
  new ResizeObserver(resize).observe(canvas);

  function camera(follow) {
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    if (!follow) {
      const scale = Math.min(cw / ARENA.WIDTH, ch / ARENA.HEIGHT);
      return { scale, x: ARENA.WIDTH / 2, y: ARENA.HEIGHT / 2, cw, ch };
    }
    const scale = Math.min(cw / RENDER.VIEW_WIDTH, ch / RENDER.VIEW_HEIGHT);
    // Keep the arena edge at the screen edge where possible; center it if it's smaller than the view.
    const clampAxis = (pos, view, size) => (view >= size ? size / 2 : Math.max(view / 2, Math.min(size - view / 2, pos)));
    return {
      scale,
      x: clampAxis(follow.x, cw / scale, ARENA.WIDTH),
      y: clampAxis(follow.y, ch / scale, ARENA.HEIGHT),
      cw,
      ch,
    };
  }

  // Shrinks the font until the label fits inside the circle, then truncates as a last resort.
  function fitLabel(label) {
    let fit = labelFits.get(label);
    if (fit) return fit;
    const maxW = PLAYER.RADIUS * 1.8;
    let size = RENDER.LABEL_FONT;
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    while (size > RENDER.LABEL_FONT_MIN && ctx.measureText(label).width > maxW) {
      size--;
      ctx.font = `700 ${size}px system-ui, sans-serif`;
    }
    let text = label;
    while (text.length > 1 && ctx.measureText(text).width > maxW) text = text.slice(0, -2) + '…';
    fit = { size, text };
    labelFits.set(label, fit);
    return fit;
  }

  function drawArena() {
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, ARENA.WIDTH, ARENA.HEIGHT);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = GRID; x < ARENA.WIDTH; x += GRID) { ctx.moveTo(x, 0); ctx.lineTo(x, ARENA.HEIGHT); }
    for (let y = GRID; y < ARENA.HEIGHT; y += GRID) { ctx.moveTo(0, y); ctx.lineTo(ARENA.WIDTH, y); }
    ctx.stroke();
    ctx.strokeStyle = COLORS.wall;
    ctx.lineWidth = 12;
    ctx.strokeRect(-6, -6, ARENA.WIDTH + 12, ARENA.HEIGHT + 12);
    for (const p of ARENA.PILLARS) {
      ctx.fillStyle = COLORS.pillar;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = COLORS.pillarTop;
      ctx.fillRect(p.x + 8, p.y + 8, p.w - 16, p.h - 16);
    }
  }

  function drawFighter(f, isMe) {
    const r = PLAYER.RADIUS;
    // Fists first so the body overlaps them.
    ctx.fillStyle = f.color;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 3;
    for (const side of [-1, 1]) {
      const a = f.aim + side * RENDER.FIST_SPREAD;
      ctx.beginPath();
      ctx.arc(f.x + Math.cos(a) * (r + 2), f.y + Math.sin(a) * (r + 2), PLAYER.FIST_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = isMe ? 4 : 3;
    ctx.strokeStyle = isMe ? COLORS.me : 'rgba(0, 0, 0, 0.5)';
    ctx.stroke();

    const { size, text } = fitLabel(f.label);
    ctx.fillStyle = textColorFor(f.color);
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, f.x, f.y);

    const barY = f.y - r - HP_BAR.gap - HP_BAR.h;
    const ratio = Math.max(0, f.hp / f.maxHp);
    ctx.fillStyle = COLORS.hpBack;
    ctx.fillRect(f.x - HP_BAR.w / 2, barY, HP_BAR.w, HP_BAR.h);
    ctx.fillStyle = ratio > 0.3 ? COLORS.hp : COLORS.hpLow;
    ctx.fillRect(f.x - HP_BAR.w / 2, barY, HP_BAR.w * ratio, HP_BAR.h);

    ctx.fillStyle = COLORS.name;
    ctx.font = `600 ${RENDER.NAME_FONT}px system-ui, sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.fillText(f.nickname, f.x, barY - 3);
  }

  function draw(view) {
    const follow = view.fighters.find((f) => f.id === view.followId && f.alive);
    cam = camera(follow);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.void;
    ctx.fillRect(0, 0, cam.cw, cam.ch);
    ctx.setTransform(
      dpr * cam.scale, 0, 0, dpr * cam.scale,
      dpr * (cam.cw / 2 - cam.x * cam.scale), dpr * (cam.ch / 2 - cam.y * cam.scale),
    );
    drawArena();
    const alive = view.fighters.filter((f) => f.alive).sort((a, b) => a.y - b.y);
    for (const f of alive) drawFighter(f, f.id === view.meId);
  }

  // Screen (client) coordinates -> world coordinates, using the last drawn frame's camera.
  function toWorld(clientX, clientY) {
    if (!cam) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: cam.x + (clientX - rect.left - cam.cw / 2) / cam.scale,
      y: cam.y + (clientY - rect.top - cam.ch / 2) / cam.scale,
    };
  }

  return { draw, toWorld };
}
