export interface TypingEffectPainter {
  pulse: () => void;
  /** Advances the effect and reports whether the engine should request another frame. */
  advance: (elapsed: number) => boolean;
  paint: (context: CanvasRenderingContext2D, width: number, height: number, ink: string) => void;
}

const MAX_FLECKS = 48;
const GRAVITY = 92;

interface Fleck {
  origin: number;
  offsetX: number;
  offsetY: number;
  velocityX: number;
  velocityY: number;
  radius: number;
  age: number;
  lifespan: number;
}

/** Ink flecks that rise from the composer toolbar, fall, and fade. */
export function createInkSplatterPainter(): TypingEffectPainter {
  const flecks: Fleck[] = [];
  let drift = 0;

  return {
    pulse() {
      drift += 0.014;
      const origin = ((Math.sin(drift * 7.3) + 1) / 2) * 0.7 + 0.15;
      const count = 1 + Math.floor(Math.random() * 2);

      for (let index = 0; index < count; index += 1) {
        flecks.push({
          origin,
          offsetX: (Math.random() - 0.5) * 26,
          offsetY: 0,
          velocityX: (Math.random() - 0.5) * 26,
          velocityY: -34 - Math.random() * 46,
          radius: 0.9 + Math.random() * 1.7,
          age: 0,
          lifespan: 0.7 + Math.random() * 0.5,
        });
      }

      if (flecks.length > MAX_FLECKS) flecks.splice(0, flecks.length - MAX_FLECKS);
    },
    advance(elapsed) {
      for (let index = flecks.length - 1; index >= 0; index -= 1) {
        const fleck = flecks[index]!;
        fleck.age += elapsed;

        if (fleck.age >= fleck.lifespan) {
          flecks.splice(index, 1);
          continue;
        }

        fleck.velocityY += GRAVITY * elapsed;
        fleck.offsetX += fleck.velocityX * elapsed;
        fleck.offsetY += fleck.velocityY * elapsed;
      }

      return flecks.length > 0;
    },
    paint(context, width, height, ink) {
      const baseline = height - 1;
      context.fillStyle = ink;

      for (const fleck of flecks) {
        const progress = fleck.age / fleck.lifespan;
        context.globalAlpha = 0.75 * (1 - progress) ** 1.6;
        context.beginPath();
        context.arc(
          fleck.origin * width + fleck.offsetX,
          baseline + fleck.offsetY,
          fleck.radius * (1 - progress * 0.35),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    },
  };
}
