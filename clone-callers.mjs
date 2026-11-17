// Preload that tallies which functions call structuredClone:
//   node --import ./clone-callers.mjs clones-min.mjs never
const real = globalThis.structuredClone;
const tally = new Map();
globalThis.structuredClone = (value, options) => {
  const frames = new Error().stack.split('\n').slice(2).map((l) => l.trim().replace(/^at /, '').replace(/\(file:.*\/node_modules\//, '('));
  const key = frames.filter((l) => !l.includes('clones-min.mjs')).slice(0, 2).join(' <- ');
  tally.set(key, (tally.get(key) ?? 0) + 1);
  return real(value, options);
};
process.on('exit', () => {
  console.log('structuredClone callers over 11 turns (1 warm-up + 10 measured):');
  for (const [key, count] of [...tally].sort((a, b) => b[1] - a[1])) console.log(String(count).padStart(6), key);
});
