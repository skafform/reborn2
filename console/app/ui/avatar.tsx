/**
 * FNV-1a over the seed, then xorshift32 — one seed, a stream of draws.
 *
 * A PRNG rather than several hashes of the same string: two hashes of one input
 * correlate, and the hue would end up tied to the grid.
 */
function draws(seed: string): () => number {
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193);
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/**
 * A GitHub-style identicon: a 5×5 grid mirrored across its vertical axis, in one
 * hue drawn from the same seed.
 *
 * Nothing is fetched. Gravatar — what GitHub itself long used — would send a
 * hash of a customer's address to a third party on every page load, and make a
 * piece of the interface depend on the network.
 *
 * ⚠️ **Seed on the account id, never on the address.** The identicon sits right
 * next to the email, so seeding on it looks natural; it would mean a face that
 * changes the day someone changes their address.
 */
export function Avatar({ seed, size = 20 }: { seed: string; size?: number }) {
  const next = draws(seed);
  const hue = Math.floor(next() * 360);

  // Columns 0 and 1 are mirrored onto 4 and 3, column 2 being the axis. That
  // symmetry is what makes a random grid read as a face rather than as noise.
  const cells: Array<[number, number]> = [];
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 5; y++) {
      if (next() >= 0.5) continue;
      cells.push([x, y]);
      if (x < 2) cells.push([4 - x, y]);
    }
  }
  // A grid can come out empty (2⁻¹⁵) — and being derived from the id, it would
  // stay empty for that account for ever. The centre cell rules it out.
  if (cells.length === 0) cells.push([2, 2]);

  return (
    <svg
      className="console-avatar"
      viewBox="0 0 5 5"
      width={size}
      height={size}
      // Without it, antialiasing draws a seam between adjacent cells.
      shapeRendering="crispEdges"
      // Decorative: the name and the address beside it carry the identity.
      aria-hidden="true"
    >
      {cells.map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="1"
          height="1"
          fill={`hsl(${hue} 62% 48%)`}
        />
      ))}
    </svg>
  );
}
