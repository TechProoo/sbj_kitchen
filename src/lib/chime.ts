/// A short two-tone chime for new tickets, synthesised so the app ships no
/// audio asset. Browsers block audio until the page has been interacted with;
/// signing in counts, so by the time tickets arrive the context is unlocked.
let context: AudioContext | null = null;

export function playNewOrderChime(): void {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();

    const now = context.currentTime;

    for (const [index, frequency] of [880, 1320].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      const start = now + index * 0.16;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.34);
    }
  } catch {
    // No audio device, or the tab has never been interacted with. The visual
    // arrival animation still fires.
  }
}
