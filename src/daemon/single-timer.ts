import type { Clock } from "./clock.ts";

export class SingleTimer {
  private generation = 0;
  private armedFor: number | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly fire: () => Promise<void>,
  ) {}

  arm(dueAt: number | null) {
    if (dueAt === null) return;
    if (this.armedFor !== null && this.armedFor <= dueAt) return;
    this.generation = this.generation + 1;
    this.armedFor = dueAt;
    void this.wait(this.generation, Math.max(0, dueAt - this.clock.now()));
  }

  cancel() {
    this.generation = this.generation + 1;
    this.armedFor = null;
  }

  private async wait(generation: number, delayMs: number) {
    await this.clock.sleep(delayMs);
    if (generation !== this.generation) return;
    this.armedFor = null;
    await this.fire();
  }
}
