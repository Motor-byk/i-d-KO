// Small math helpers shared by the server and client.

export const lerp = (a, b, k) => a + (b - a) * k;

// Wraps an angle to [-pi, pi].
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Signed shortest turn from b to a, in [-pi, pi].
export const angleDiff = (a, b) => wrapAngle(a - b);

// Turns from a toward b the short way round.
export const lerpAngle = (a, b, k) => a + angleDiff(b, a) * k;
