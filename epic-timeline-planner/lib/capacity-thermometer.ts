/**
 * Vertical (or horizontal) capacity gauge fluid colors: green when plenty of headroom,
 * smooth transition through yellow / orange toward red as load approaches and exceeds capacity.
 *
 * @param stressRatio Load divided by capacity (e.g. 0.4 = 40%, 1 = full, 1.15 = 15% over). Non-finite or negative → treated as 0.
 */
export function capacityGaugeFluidStops(stressRatio: number): { top: string; mid: string; bot: string } {
  const x = Math.min(1.22, Math.max(0, Number.isFinite(stressRatio) ? stressRatio : 0));

  type Key = { x: number; top: string; mid: string; bot: string };
  const keys: Key[] = [
    { x: 0, top: "#d1fae5", mid: "#34d399", bot: "#047857" },
    { x: 0.32, top: "#a7f3d0", mid: "#10b981", bot: "#065f46" },
    { x: 0.58, top: "#bef264", mid: "#65a30d", bot: "#3f6212" },
    { x: 0.76, top: "#fde047", mid: "#ca8a04", bot: "#854d0e" },
    { x: 0.9, top: "#fdba74", mid: "#ea580c", bot: "#9a3412" },
    { x: 1, top: "#fecaca", mid: "#ef4444", bot: "#991b1b" },
    { x: 1.22, top: "#fca5a5", mid: "#dc2626", bot: "#450a0a" },
  ];

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1]!.x < x) i++;
  const k0 = keys[i]!;
  const k1 = keys[i + 1] ?? k0;
  const span = k1.x - k0.x || 1e-6;
  const t = (x - k0.x) / span;

  return {
    top: mixHex(k0.top, k1.top, t),
    mid: mixHex(k0.mid, k1.mid, t),
    bot: mixHex(k0.bot, k1.bot, t),
  };
}

function mixHex(a: string, b: string, t: number): string {
  const p = (s: string) => [
    parseInt(s.slice(1, 3), 16),
    parseInt(s.slice(3, 5), 16),
    parseInt(s.slice(5, 7), 16),
  ] as const;
  const A = p(a);
  const B = p(b);
  const clampT = Math.max(0, Math.min(1, t));
  const mix = (i: number) => Math.round(A[i] + (B[i] - A[i]) * clampT);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(mix(0))}${h(mix(1))}${h(mix(2))}`;
}
