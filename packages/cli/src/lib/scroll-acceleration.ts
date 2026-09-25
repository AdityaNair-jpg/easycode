import { MacOSScrollAccel, type ScrollAcceleration } from "@opentui/core";

// Terminals typically scroll about three lines per wheel tick
const LINES_PER_TICK = 3;

// Scrolls three lines per tick at a relaxed pace, ramping to twelve for a
// fast flick, so long replies are quick to get through without losing
// precision on slow scrolling. The default moves one line per tick.
export class ConversationScrollAccel implements ScrollAcceleration {
  private readonly curve = new MacOSScrollAccel({ maxMultiplier: 4 });

  tick(now?: number): number {
    return LINES_PER_TICK * this.curve.tick(now);
  }

  reset(): void {
    this.curve.reset();
  }
};
