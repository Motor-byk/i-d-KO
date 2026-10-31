// Held buttons plus everything pressed since the last take(), so a press shorter than one
// input tick is still sent. Shared by every input device so presses mean the same thing.
export function buttonLatch() {
  let held = 0;
  let tapped = 0;
  return {
    press(bit) { held |= bit; tapped |= bit; },
    tap(bit) { tapped |= bit; },
    release(bit) { held &= ~bit; },
    releaseAll() { held = 0; },
    take() {
      const buttons = held | tapped;
      tapped = 0;
      return buttons;
    },
  };
}
