/**
 * A cloud of ink motes. Each ink's motes are born around its home and carried
 * along its drift over their lives, so one ink rises gently at rest while two
 * can converge and mingle. A faint wash of each ink gives the cloud a body;
 * motes wander within it, breathe with the cloud, and are reborn when their
 * life ends, so the cloud never freezes or visibly loops, and now and then one
 * catches the light. The cloud reacts to a pointer nearby by parting or
 * stirring its motes and lighting them; a distant one makes the whole cloud
 * lean toward it, just slightly.
 *
 * Coordinates are relative to the cloud's center so the simulation is
 * independent of the canvas it is painted onto.
 */

export interface Point {
  x: number;
  y: number;
}

/** One ink in the cloud. */
export interface Ink {
  /** A canvas-ready color. */
  color: string;
  /** Relative to the cloud's center; motes cross it mid-life. */
  home: Point;
  /** Nominal travel over a mote's life, in CSS pixels: the ink's direction of flow. */
  drift: Point;
}

/** How the cloud reacts to a nearby pointer: a breeze parts the motes, a stir circulates them. */
export type Reaction = "part" | "stir";

/** The lightness of the surface beneath the cloud; ink over dark needs a stronger wash. */
export type Surface = "light" | "dark";

export interface InkCloudOptions {
  inks: readonly Ink[];
  reaction: Reaction;
  surface: Surface;
  /** Uniform random source in [0, 1), injectable so tests see a deterministic cloud. */
  random?: () => number;
}

export interface InkCloud {
  /** Advances the cloud by `elapsed` seconds; `pointer` is center-relative, or null when away. */
  advance: (elapsed: number, pointer: Point | null) => void;
  paint: (context: CanvasRenderingContext2D, width: number, height: number) => void;
}

/** Motes per ink. */
const MOTE_COUNT = 40;

/** Standard deviation of motes around their ink's home, in CSS pixels; wider than tall. */
const SPREAD_X = 40;
const SPREAD_Y = 22;
/** Homes are clamped to this many deviations so each ink keeps a soft but definite edge. */
const SPREAD_LIMIT = 2.1;
/** Each mote travels its ink's drift scaled by this much. */
const DRIFT_SCALE = { min: 0.65, max: 1.35 };

const WANDER_AMPLITUDE = { min: 3.5, max: 8 };
const WANDER_PERIOD = { min: 4, max: 10 };
const LIFESPAN = { min: 7, max: 14 };
const FADE_IN = 1.8;
const FADE_OUT = 2.4;

const BREATH_AMPLITUDE = 0.06;
const BREATH_PERIOD = 7.3;
const SWAY_AMPLITUDE = 4;
const SWAY_PERIOD = 11.7;
const MOUNT_FADE = 1.1;

/** A share of motes briefly catch the light once in their life. */
const GLINT_CHANCE = 0.3;
const GLINT_DURATION = 1.2;
const GLINT_ALPHA = 0.9;
const GLINT_SCALE = 0.6;

/** How far a pointer's influence reaches, in CSS pixels. */
const POINTER_REACH = 130;
/** Displacement of a mote at the pointer, in CSS pixels: away from it, and around it. */
const REACTION: Record<Reaction, { push: number; swirl: number }> = {
  part: { push: 24, swirl: 12 },
  stir: { push: 6, swirl: 22 },
};
const REACTION_TAU = 0.22;
/** How much a mote brightens at the pointer. */
const POINTER_LIGHT = 0.7;
/** A pointer's presence arrives quickly and dies away slowly. */
const PRESENCE_IN_TAU = 0.12;
const PRESENCE_OUT_TAU = 0.4;
const LEAN_RANGE = 360;
const LEAN_MAX = 8;
const LEAN_TAU = 0.45;

const WASH_ALPHA: Record<Surface, number> = { light: 0.09, dark: 0.18 };
const WASH_RADIUS = 2.6 * SPREAD_X;
const BASE_ALPHA = 0.62;
const HALO_ALPHA = 0.45;
const HALO_SCALE = 3.4;
/** Motes dissolve this close to the canvas edge instead of being clipped by it. */
const EDGE_FADE = 14;

interface Wave {
  amplitude: number;
  frequency: number;
  phase: number;
}

interface Mote {
  ink: Ink;
  /** Born here, and carried `travel` further over a life. */
  startX: number;
  startY: number;
  travelX: number;
  travelY: number;
  radius: number;
  /** Peak alpha: near motes are brighter, and motes at the ink's edge fainter. */
  brightness: number;
  lifespan: number;
  age: number;
  /** Age at which this mote glints, or Infinity if it never does. */
  glintAt: number;
  wanderX: [Wave, Wave];
  wanderY: [Wave, Wave];
  /** Eased reaction to the pointer, carried between frames so motes flow rather than jump. */
  reactionX: number;
  reactionY: number;
  x: number;
  y: number;
  alpha: number;
  /** 0..1 extra brightness and size from a glint or the pointer's light. */
  glow: number;
}

export function createInkCloud({
  inks,
  reaction,
  surface,
  random = Math.random,
}: InkCloudOptions): InkCloud {
  // The initial population starts mid-life so the cloud is already there.
  const motes = inks.flatMap((ink) =>
    Array.from({ length: MOTE_COUNT }, () => {
      const mote = spawnMote(random, ink);
      mote.age = random() * mote.lifespan;
      return mote;
    }),
  );
  const { push, swirl } = REACTION[reaction];
  let time = 0;
  /** The last known pointer keeps steering the reaction as it dies away after the pointer leaves. */
  const pointer: Point = { x: 0, y: 0 };
  let presence = 0;
  let leanX = 0;
  let leanY = 0;
  let breath = 1;
  let sway = 0;
  let mount = 0;

  return {
    advance(elapsed, target) {
      time += elapsed;

      if (target) {
        pointer.x = target.x;
        pointer.y = target.y;
        presence += (1 - presence) * ease(elapsed, PRESENCE_IN_TAU);
      } else {
        presence -= presence * ease(elapsed, PRESENCE_OUT_TAU);
      }

      const leanBlend = ease(elapsed, LEAN_TAU);
      leanX += (clamp(pointer.x / LEAN_RANGE, -1, 1) * LEAN_MAX * presence - leanX) * leanBlend;
      leanY += (clamp(pointer.y / LEAN_RANGE, -1, 1) * LEAN_MAX * presence - leanY) * leanBlend;

      breath = 1 + BREATH_AMPLITUDE * Math.sin((Math.PI * 2 * time) / BREATH_PERIOD);
      sway = SWAY_AMPLITUDE * Math.sin((Math.PI * 2 * time) / SWAY_PERIOD);
      mount = smoothstep(0, MOUNT_FADE, time);
      const reactionBlend = ease(elapsed, REACTION_TAU);

      for (const mote of motes) {
        mote.age += elapsed;
        if (mote.age >= mote.lifespan) Object.assign(mote, spawnMote(random, mote.ink));

        const progress = mote.age / mote.lifespan;
        const restX =
          (mote.startX + mote.travelX * progress + sum(mote.wanderX, time)) * breath + sway + leanX;
        const restY =
          (mote.startY + mote.travelY * progress + sum(mote.wanderY, time)) * breath + leanY;

        const dx = restX - pointer.x;
        const dy = restY - pointer.y;
        const distance = Math.hypot(dx, dy);
        const lit = distance < POINTER_REACH ? (1 - distance / POINTER_REACH) ** 2 * presence : 0;
        const ux = dx / (distance || 1);
        const uy = dy / (distance || 1);
        mote.reactionX += ((ux * push - uy * swirl) * lit - mote.reactionX) * reactionBlend;
        mote.reactionY += ((uy * push + ux * swirl) * lit - mote.reactionY) * reactionBlend;
        mote.x = restX + mote.reactionX;
        mote.y = restY + mote.reactionY;

        const glintAge = mote.age - mote.glintAt;
        const glint =
          glintAge > 0 && glintAge < GLINT_DURATION
            ? Math.sin((Math.PI * glintAge) / GLINT_DURATION)
            : 0;
        mote.glow = Math.min(1, glint + lit * POINTER_LIGHT);

        const life =
          smoothstep(0, FADE_IN, mote.age) *
          (1 - smoothstep(mote.lifespan - FADE_OUT, mote.lifespan, mote.age));
        mote.alpha = mote.brightness * life * mount * (1 + GLINT_ALPHA * mote.glow);
      }
    },
    paint(context, width, height) {
      const disc = (
        x: number,
        y: number,
        radius: number,
        fill: string | CanvasGradient,
        alpha: number,
      ) => {
        context.globalAlpha = alpha;
        context.fillStyle = fill;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      };
      const glow = (x: number, y: number, radius: number, color: string, alpha: number) => {
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, "transparent");
        disc(x, y, radius, gradient, alpha);
      };

      // Each ink's wash: two stacked discs approximate a soft bell, squashed to the ink's shape.
      for (const { color, home } of inks) {
        context.save();
        context.translate(
          width / 2 + home.x * breath + sway + leanX,
          height / 2 + home.y * breath + leanY,
        );
        context.scale(breath, (breath * SPREAD_Y) / SPREAD_X);
        glow(0, 0, WASH_RADIUS, color, WASH_ALPHA[surface] * mount);
        glow(0, 0, WASH_RADIUS / 2, color, WASH_ALPHA[surface] * 0.7 * mount);
        context.restore();
      }

      for (const mote of motes) {
        const x = width / 2 + mote.x;
        const y = height / 2 + mote.y;
        const edge = smoothstep(0, EDGE_FADE, Math.min(x, y, width - x, height - y));
        const alpha = Math.min(1, mote.alpha * edge);
        if (alpha <= 0) continue;

        const radius = mote.radius * (1 + GLINT_SCALE * mote.glow);
        glow(x, y, radius * HALO_SCALE, mote.ink.color, alpha * HALO_ALPHA);
        disc(x, y, radius, mote.ink.color, alpha);
      }
    },
  };
}

function spawnMote(random: () => number, ink: Ink): Mote {
  const depth = random();
  const lifespan = between(random, LIFESPAN);
  const scale = between(random, DRIFT_SCALE);
  const gx = clamp(gaussian(random), -SPREAD_LIMIT, SPREAD_LIMIT);
  const gy = clamp(gaussian(random), -SPREAD_LIMIT, SPREAD_LIMIT);
  const edge = (gx * gx + gy * gy) / SPREAD_LIMIT ** 2;

  return {
    ink,
    startX: ink.home.x + gx * SPREAD_X - (ink.drift.x * scale) / 2,
    startY: ink.home.y + gy * SPREAD_Y - (ink.drift.y * scale) / 2,
    travelX: ink.drift.x * scale,
    travelY: ink.drift.y * scale,
    radius: 0.8 + depth ** 1.6 * 2.2,
    brightness: BASE_ALPHA * (0.35 + 0.65 * depth) * (1 - 0.4 * Math.min(1, edge)),
    lifespan,
    age: 0,
    glintAt:
      random() < GLINT_CHANCE
        ? FADE_IN + random() * (lifespan - FADE_IN - FADE_OUT - GLINT_DURATION)
        : Infinity,
    wanderX: [wave(random), wave(random)],
    wanderY: [wave(random), wave(random)],
    reactionX: 0,
    reactionY: 0,
    x: 0,
    y: 0,
    alpha: 0,
    glow: 0,
  };
}

function wave(random: () => number): Wave {
  return {
    amplitude: between(random, WANDER_AMPLITUDE),
    frequency: (Math.PI * 2) / between(random, WANDER_PERIOD),
    phase: random() * Math.PI * 2,
  };
}

function sum(waves: readonly Wave[], time: number): number {
  let total = 0;
  for (const { amplitude, frequency, phase } of waves) {
    total += amplitude * Math.sin(frequency * time + phase);
  }
  return total;
}

/** Frame-rate independent share of the remaining distance to close this frame. */
function ease(elapsed: number, tau: number): number {
  return 1 - Math.exp(-elapsed / tau);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function between(random: () => number, range: { min: number; max: number }): number {
  return range.min + random() * (range.max - range.min);
}

/** Standard normal sample via Box–Muller; the first uniform is kept off zero for the log. */
function gaussian(random: () => number): number {
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}
