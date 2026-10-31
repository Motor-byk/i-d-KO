import { ARENA, PLAYER, RENDER, COMBAT } from '../shared/constants.js';
import { STATE, moveTiming, phase, chargeFraction, isParrying } from '../shared/combat-state.js';

const COLORS = {
  void: '#0d0e12',
  floor: '#1d1f27',
  grid: '#252833',
  wall: '#3a3e4d',  // outer walls and pillar edges
  pillarTop: '#4a4f62',
  hpBack: 'rgba(0, 0, 0, 0.55)',
  hp: '#06d6a0',
  hpLow: '#ef476f',
  name: '#f2f2f5',
  me: '#ffffff',
  outline: 'rgba(0, 0, 0, 0.5)',
  hitstun: 'rgba(255, 255, 255, 0.3)',
  hitstop: 'rgba(255, 255, 255, 0.75)',
  charge: 'rgba(255, 255, 255, 0.8)',
  charged: '#ffd166',
  parry: '#9be7ff',
  parryWhiff: 'rgba(155, 231, 255, 0.3)',
  stun: '#ffd166',
  burst: 'rgba(255, 255, 255, 0.5)',
  dashCharging: '#5c6b80',
  dashReady: '#9be7ff',
};
const STUN_DOTS = 3;
const INVULN_ALPHA = 0.55;
const DASH_GHOSTS = [{ back: 0.9, alpha: 0.18 }, { back: 0.45, alpha: 0.32 }];

const GRID = 100;
const labelFont = (size) => `700 ${size}px system-ui, sans-serif`;
const HP_BAR = { w: PLAYER.RADIUS * 2, h: 6, gap: 10 };
// Your own dash cooldown: a vertical bar beside your fighter, full when the dash is ready.
const DASH_BAR = { w: 5, h: PLAYER.RADIUS * 1.6, gap: 14 };

// Dark text on light team colors, light text on dark ones.
function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#15161c' : '#ffffff';
}

// How far each fist [left, right] is pushed out past its rest spot, 0..1 of the move's reach.
function fistExtension(cs) {
  if (cs.state === STATE.CHARGE) return [-0.3, -0.3]; // drawn back
  const m = moveTiming(cs);
  if (!m) return [0, 0];
  let k;
  switch (phase(cs)) {
    case 'startup': k = -0.1; break; // wind up
    case 'active': k = 1; break;
    default: k = 1 - (cs.t - m.startup - m.active) / m.recovery;
  }
  // The jab string alternates hands; the finisher and the heavy throw both.
  if (cs.state === STATE.HEAVY || cs.jab === COMBAT.JAB.length - 1) return [k, k];
  return cs.jab % 2 ? [0, k] : [k, 0];
}

// Canvas renderer. draw(view) with view = { fighters: [{ id, x, y, aim, hp, maxHp, alive, cs,
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
  const resizer = new ResizeObserver(resize);
  resizer.observe(canvas);

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
    ctx.font = labelFont(size);
    while (size > RENDER.LABEL_FONT_MIN && ctx.measureText(label).width > maxW) {
      size--;
      ctx.font = labelFont(size);
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
      ctx.fillStyle = COLORS.wall;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = COLORS.pillarTop;
      ctx.fillRect(p.x + 8, p.y + 8, p.w - 16, p.h - 16);
    }
  }

  function ring(x, y, radius, width, color, from = 0, to = Math.PI * 2) {
    ctx.beginPath();
    ctx.arc(x, y, radius, from, to);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function drawFighter(f, isMe) {
    const r = PLAYER.RADIUS;
    if (f.cs.state === STATE.DASH) {
      // Fading copies trailing behind the dash.
      ctx.fillStyle = f.color;
      for (const g of DASH_GHOSTS) {
        ctx.globalAlpha = g.alpha;
        ctx.beginPath();
        ctx.arc(f.x - Math.cos(f.cs.dir) * r * 2 * g.back, f.y - Math.sin(f.cs.dir) * r * 2 * g.back, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const m = moveTiming(f.cs);
    const charging = f.cs.state === STATE.CHARGE;
    const dir = m || charging ? f.cs.dir : f.aim;
    const reach = m?.reach ?? COMBAT.HEAVY.reach;
    const ext = fistExtension(f.cs);
    if (f.cs.invuln > 0) ctx.globalAlpha = INVULN_ALPHA; // see-through: hits pass
    // Fists first so the body overlaps them. A punching fist swings in toward the center line.
    ctx.fillStyle = f.color;
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 3;
    [-1, 1].forEach((side, i) => {
      const k = Math.max(0, ext[i]);
      const a = dir + side * RENDER.FIST_SPREAD * (1 - k * 0.8);
      const d = r + 2 + ext[i] * reach;
      ctx.beginPath();
      ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, PLAYER.FIST_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = isMe ? 4 : 3;
    ctx.strokeStyle = isMe ? COLORS.me : COLORS.outline;
    ctx.stroke();
    switch (f.cs.state) {
      case STATE.HITSTUN:
        ctx.fillStyle = f.cs.hitstop ? COLORS.hitstop : COLORS.hitstun;
        ctx.fill();
        break;
      case STATE.BURST: {
        // A ring blasting outward to the push radius.
        const k = (f.cs.t + 1) / COMBAT.BURST_TICKS;
        ring(f.x, f.y, r + (COMBAT.BURST_RADIUS - r) * k, 6 * (1 - k) + 1, COLORS.burst);
        break;
      }
      case STATE.PARRY: {
        const active = isParrying(f.cs);
        ring(f.x, f.y, r + 9, active ? 5 : 2, active ? COLORS.parry : COLORS.parryWhiff);
        break;
      }
      case STATE.STUNNED:
        // Dots circling over the head.
        ctx.fillStyle = COLORS.stun;
        for (let i = 0; i < STUN_DOTS; i++) {
          const a = f.cs.t * 0.3 + (i * Math.PI * 2) / STUN_DOTS;
          ctx.beginPath();
          ctx.arc(f.x + Math.cos(a) * r * 0.7, f.y - r * 0.2 + Math.sin(a) * r * 0.25, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case STATE.CHARGE: {
        const k = chargeFraction(f.cs.t);
        const from = -Math.PI / 2;
        ring(f.x, f.y, r + 7, 4, k >= 1 ? COLORS.charged : COLORS.charge, from, from + Math.PI * 2 * Math.max(k, 0.02));
        break;
      }
    }
    ctx.globalAlpha = 1;

    const { size, text } = fitLabel(f.label);
    ctx.fillStyle = textColorFor(f.color);
    ctx.font = labelFont(size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, f.x, f.y);

    const barY = f.y - r - HP_BAR.gap - HP_BAR.h;
    const ratio = Math.max(0, f.hp / f.maxHp);
    ctx.fillStyle = COLORS.hpBack;
    ctx.fillRect(f.x - HP_BAR.w / 2, barY, HP_BAR.w, HP_BAR.h);
    ctx.fillStyle = ratio > 0.3 ? COLORS.hp : COLORS.hpLow;
    ctx.fillRect(f.x - HP_BAR.w / 2, barY, HP_BAR.w * ratio, HP_BAR.h);

    if (isMe) {
      const ready = 1 - f.cs.dashCooldown / COMBAT.DASH.cooldown;
      const x = f.x + r + DASH_BAR.gap;
      const y = f.y - DASH_BAR.h / 2;
      ctx.fillStyle = COLORS.hpBack;
      ctx.fillRect(x, y, DASH_BAR.w, DASH_BAR.h);
      ctx.fillStyle = ready >= 1 ? COLORS.dashReady : COLORS.dashCharging;
      ctx.fillRect(x, y + DASH_BAR.h * (1 - ready), DASH_BAR.w, DASH_BAR.h * ready);
    }

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

  return { draw, toWorld, destroy: () => resizer.disconnect() };
}
