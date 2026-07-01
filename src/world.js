// src/world.js — world state (player, target, bounds) and movement.
// Coordinate convention: world y increases UP. Only the render layer flips y.

export function createWorld() {
  return {
    player: { x: -8, y: -6 },
    target: { x: 6, y: 5 },
    bounds: { minX: -20, maxX: 20, minY: -20, maxY: 20 },
  };
}

// Adds ddx,ddy to world.player, clamps to bounds. Returns void.
export function movePlayer(world, ddx, ddy) {
  const { player, bounds } = world;
  player.x = clamp(player.x + ddx, bounds.minX, bounds.maxX);
  player.y = clamp(player.y + ddy, bounds.minY, bounds.maxY);
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
