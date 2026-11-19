/**
 * A short chime made with Web Audio (no sound file to host). Browsers only allow sound after the user has clicked on
 * the page, so `unlock()` is called from a click; until then `play()` is silently skipped.
 */
let ctx: AudioContext | null = null;

export function unlockChime() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return true;
  } catch { return false; }
}

/** 'new': two rising notes (a chat is waiting). 'message': one soft note (a new message in your chat). */
export function playChime(kind: 'new' | 'message' = 'new') {
  if (!ctx || ctx.state !== 'running') return;
  const notes = kind === 'new' ? [[660, 0], [880, 0.18]] : [[740, 0]];
  const now = ctx.currentTime;
  for (const [freq, at] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq!;
    gain.gain.setValueAtTime(0.0001, now + at!);
    gain.gain.exponentialRampToValueAtTime(kind === 'new' ? 0.25 : 0.12, now + at! + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at! + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + at!);
    osc.stop(now + at! + 0.5);
  }
}
