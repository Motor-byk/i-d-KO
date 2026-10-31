import { ARENA } from './constants.js';

// Arena collision for circles: outer walls + solid rectangular pillars.
// Shared so client prediction collides exactly like the server. Collision order is fixed
// (walls, then pillars in array order) so both sides resolve contacts the same way.

// Movement is split into substeps no longer than this fraction of the radius, so a fast
// circle (dash, launch) can never skip over a pillar or wall in a single tick.
const SUBSTEP_FRACTION = 0.5;

// Pushes a circle out of one rect. Returns the unit normal pointing out of the rect, or null.
function pushOutOfRect(p, r, rect) {
  const cx = Math.max(rect.x, Math.min(p.x, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(p.y, rect.y + rect.h));
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 0) {
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    p.x = cx + nx * r;
    p.y = cy + ny * r;
    return { x: nx, y: ny };
  }
  // Center inside the rect: leave through the nearest side.
  const exits = [
    [p.x - rect.x, -1, 0],
    [rect.x + rect.w - p.x, 1, 0],
    [p.y - rect.y, 0, -1],
    [rect.y + rect.h - p.y, 0, 1],
  ];
  const [, nx, ny] = exits.reduce((best, e) => (e[0] < best[0] ? e : best));
  if (nx) p.x = nx < 0 ? rect.x - r : rect.x + rect.w + r;
  else p.y = ny < 0 ? rect.y - r : rect.y + rect.h + r;
  return { x: nx, y: ny };
}

function pushInsideBounds(p, r, normals) {
  if (p.x < r) { p.x = r; normals.push({ x: 1, y: 0 }); }
  else if (p.x > ARENA.WIDTH - r) { p.x = ARENA.WIDTH - r; normals.push({ x: -1, y: 0 }); }
  if (p.y < r) { p.y = r; normals.push({ x: 0, y: 1 }); }
  else if (p.y > ARENA.HEIGHT - r) { p.y = ARENA.HEIGHT - r; normals.push({ x: 0, y: -1 }); }
}

// Resolves overlap at the current position. Returns the contact normals (may be empty).
export function resolveCircle(p, r) {
  const normals = [];
  pushInsideBounds(p, r, normals);
  for (const pillar of ARENA.PILLARS) {
    const n = pushOutOfRect(p, r, pillar);
    if (n) normals.push(n);
  }
  return normals;
}

// Moves a circle by (dx, dy), sliding along anything it touches.
// Returns { x, y, normals }: every contact normal hit along the way, for wall bounces.
export function sweepCircle(x, y, dx, dy, r) {
  const p = { x, y };
  const normals = [];
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (r * SUBSTEP_FRACTION)));
  let sx = dx / steps;
  let sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    p.x += sx;
    p.y += sy;
    for (const n of resolveCircle(p, r)) {
      normals.push(n);
      // Drop the rest of the motion that points into the surface, so we slide along it.
      const into = sx * n.x + sy * n.y;
      if (into < 0) {
        sx -= into * n.x;
        sy -= into * n.y;
      }
    }
  }
  return { x: p.x, y: p.y, normals };
}

// Reflects a velocity off the first contact normal it moves into. Returns null if none do.
export function bounceVelocity(vx, vy, normals, restitution) {
  for (const n of normals) {
    const into = vx * n.x + vy * n.y;
    if (into < 0) {
      return {
        vx: (vx - 2 * into * n.x) * restitution,
        vy: (vy - 2 * into * n.y) * restitution,
      };
    }
  }
  return null;
}
