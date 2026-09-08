import { describe, expect, test } from "bun:test";
import {
  createInkCloud,
  type Ink,
  type InkCloud,
  type InkCloudOptions,
  type Point,
} from "./inkCloud";

const WIDTH = 256;
const HEIGHT = 176;
const FRAME = 1 / 60;
const CENTER: Point = { x: 0, y: 0 };

/** A single ink rising gently: the session placeholder. */
const RISING: Ink = { color: "#facc15", home: { x: 0, y: 0 }, drift: { x: 0, y: -25 } };
/** Two inks converging from below and above: the channel placeholder. */
const FROM_BELOW: Ink = { color: "#facc15", home: { x: 0, y: 26 }, drift: { x: 0, y: -44 } };
const FROM_ABOVE: Ink = { color: "#22d3ee", home: { x: 0, y: -26 }, drift: { x: 0, y: 44 } };

function cloud(seed: number, options: Partial<InkCloudOptions> = {}): InkCloud {
  return createInkCloud({
    inks: [RISING],
    reaction: "part",
    surface: "light",
    random: seeded(seed),
    ...options,
  });
}

describe("ink cloud", () => {
  test("keeps every mote inside the canvas while idling", () => {
    const ink = cloud(3);
    const strays: Point[] = [];

    for (let second = 0; second < 90; second += 1) {
      for (const core of snapshot(ink, 1).cores) {
        if (core.x < 0 || core.x > WIDTH || core.y < 0 || core.y > HEIGHT) strays.push(core);
      }
    }

    expect(strays).toEqual([]);
  });

  test("parts under a nearby pointer and rejoins its path after the pointer leaves", () => {
    const control = cloud(4);
    const disturbed = cloud(4);
    snapshot(control, 3);
    snapshot(disturbed, 3);

    const parted = snapshot(disturbed, 1.5, CENTER);
    const undisturbed = snapshot(control, 1.5);
    expect(spread(parted)).toBeGreaterThan(spread(undisturbed) + 3);

    const rejoined = snapshot(disturbed, 3);
    const reference = snapshot(control, 3);
    expect(Math.abs(spread(rejoined) - spread(reference))).toBeLessThan(0.5);
  });

  test("a stir carries motes around the pointer, where a breeze pushes them away", () => {
    const control = cloud(5);
    const parted = cloud(5);
    const stirred = cloud(5, { reaction: "stir" });
    snapshot(control, 3);
    snapshot(parted, 3);
    snapshot(stirred, 3);

    // Sampled as the pointer arrives, while motes are still nearest to where they were.
    const reference = snapshot(control, 0.1);
    const breeze = motion(reference, snapshot(parted, 0.1, CENTER));
    const stir = motion(reference, snapshot(stirred, 0.1, CENTER));
    expect(breeze.away).toBeGreaterThan(Math.abs(breeze.around));
    expect(Math.abs(stir.around)).toBeGreaterThan(stir.away);
  });

  test("leans slightly toward a distant pointer without deforming", () => {
    const control = cloud(6);
    const leaning = cloud(6);
    snapshot(control, 3);
    snapshot(leaning, 3);

    const reference = snapshot(control, 2);
    const leaned = snapshot(leaning, 2, { x: 0, y: 600 });
    const shift = centroid(leaned.cores).y - centroid(reference.cores).y;
    expect(shift).toBeGreaterThan(2);
    expect(shift).toBeLessThan(spread(reference) / 3);
    expect(Math.abs(spread(leaned) - spread(reference))).toBeLessThan(0.5);
  });

  test("is reborn rather than thinning out", () => {
    const ink = cloud(7);
    snapshot(ink, 2);

    const brightness = Array.from({ length: 120 }, () => snapshot(ink, 1).brightness);
    const typical = brightness.reduce((sum, value) => sum + value, 0) / brightness.length;

    expect(Math.min(...brightness)).toBeGreaterThan(typical / 2);
  });

  test("two inks flow toward each other", () => {
    const inks = cloud(8, { inks: [FROM_BELOW, FROM_ABOVE], reaction: "stir" });
    snapshot(inks, 3);

    expect(flow(inks, FROM_BELOW.color).y).toBeLessThan(-1);
    expect(flow(inks, FROM_ABOVE.color).y).toBeGreaterThan(1);
  });
});

type Core = Point & { color: string };
type Snapshot = ReturnType<typeof snapshot>;

/** Advances the cloud for `seconds` at 60fps and paints the final frame. */
function snapshot(cloud: InkCloud, seconds: number, pointer: Point | null = null) {
  for (let elapsed = 0; elapsed < seconds; elapsed += FRAME) {
    cloud.advance(FRAME, pointer);
  }

  const record = recordingContext();
  cloud.paint(record.context, WIDTH, HEIGHT);
  return record;
}

function centroid(cores: readonly Point[]): Point {
  return {
    x: cores.reduce((sum, core) => sum + core.x, 0) / cores.length,
    y: cores.reduce((sum, core) => sum + core.y, 0) / cores.length,
  };
}

/** Mean distance of the motes from their own centroid: the cloud's size, wherever it sits. */
function spread({ cores }: Snapshot): number {
  const middle = centroid(cores);
  return cores.reduce((sum, core) => sum + distance(core, middle), 0) / cores.length;
}

/** Mean velocity of an ink's motes, in CSS pixels per second, following each to its next frame. */
function flow(cloud: InkCloud, color: string): Point {
  const total = { x: 0, y: 0 };
  let count = 0;
  let previous = snapshot(cloud, 0.5).cores.filter((core) => core.color === color);
  for (let interval = 0; interval < 20; interval += 1) {
    const current = snapshot(cloud, 0.5).cores.filter((core) => core.color === color);
    for (const core of previous) {
      const next = nearest(core, current);
      total.x += next.x - core.x;
      total.y += next.y - core.y;
      count += 1;
    }
    previous = current;
  }
  return { x: (total.x / count) * 2, y: (total.y / count) * 2 };
}

/** Mean displacement of the motes under a pointer at the center, away from it and around it. */
function motion(reference: Snapshot, touched: Snapshot): { away: number; around: number } {
  const pointer = { x: WIDTH / 2, y: HEIGHT / 2 };
  const total = { away: 0, around: 0 };
  for (const core of reference.cores) {
    const next = nearest(core, touched.cores);
    const radius = distance(core, pointer) || 1;
    const ux = (core.x - pointer.x) / radius;
    const uy = (core.y - pointer.y) / radius;
    total.away += (next.x - core.x) * ux + (next.y - core.y) * uy;
    total.around += (next.y - core.y) * ux - (next.x - core.x) * uy;
  }
  return {
    away: total.away / reference.cores.length,
    around: total.around / reference.cores.length,
  };
}

function nearest(core: Point, candidates: readonly Core[]): Core {
  return candidates.reduce((best, candidate) =>
    distance(core, candidate) < distance(core, best) ? candidate : best,
  );
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Records each solid ink fill as a mote core; gradient fills are the washes and halos around them. */
function recordingContext() {
  const record = {
    cores: [] as Core[],
    brightness: 0,
    context: undefined as unknown as CanvasRenderingContext2D,
  };

  let fillStyle: unknown = "";
  let pending: Point | null = null;
  const context = {
    globalAlpha: 1,
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: unknown) {
      fillStyle = value;
    },
    createRadialGradient: () => ({ addColorStop: () => {} }),
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    beginPath: () => {},
    arc: (x: number, y: number) => {
      pending = { x, y };
    },
    fill: () => {
      if (typeof fillStyle !== "string" || !pending) return;
      record.cores.push({ ...pending, color: fillStyle });
      record.brightness += context.globalAlpha;
    },
  };

  record.context = context as unknown as CanvasRenderingContext2D;
  return record;
}

/** mulberry32: a small deterministic PRNG so each test sees the same cloud. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
