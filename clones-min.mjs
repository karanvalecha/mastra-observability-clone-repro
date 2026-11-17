// Counts structuredClone calls per agent turn. No database, model provider or API key.
//   node clones-min.mjs off      -> no observability configured
//   node clones-min.mjs never    -> observability on, sampling "never"
//   node clones-min.mjs always   -> observability on, sampling "always"
// Optional: LOGGING=off sets `logging: { enabled: false }`; META_FIELDS=4 shrinks the span metadata (default 40 fields, about 4 KB).
const mode = process.argv[2] ?? 'never';

let calls = 0;
let ms = 0;
const realClone = globalThis.structuredClone;
globalThis.structuredClone = (value, options) => {
  calls += 1;
  const t = performance.now();
  try {
    return realClone(value, options);
  } finally {
    ms += performance.now() - t;
  }
};

const { Mastra } = await import('@mastra/core');
const { Agent } = await import('@mastra/core/agent');
const { createTool } = await import('@mastra/core/tools');
const { MockLanguageModelV3 } = await import('ai/test');
const { simulateReadableStream } = await import('ai');
const { z } = await import('zod');

const lookup = createTool({
  id: 'lookup',
  description: 'Looks up a record.',
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }) => ({ id, title: 'Record' }),
});

const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 50, text: 50, reasoning: 0 } };
let callSeq = 0;
const model = new MockLanguageModelV3({
  provider: 'mock',
  modelId: 'mock-model',
  doStream: async ({ prompt }) => {
    const id = `call_${++callSeq}`;
    const chunks = [{ type: 'stream-start', warnings: [] }];
    if (prompt[prompt.length - 1]?.role !== 'tool') {
      const input = JSON.stringify({ id: 'rec-1' });
      chunks.push(
        { type: 'tool-input-start', id, toolName: 'lookup' },
        { type: 'tool-input-delta', id, delta: input },
        { type: 'tool-input-end', id },
        { type: 'tool-call', toolCallId: id, toolName: 'lookup', input },
        { type: 'finish', finishReason: 'tool-calls', usage },
      );
    } else {
      chunks.push({ type: 'text-start', id: 't' });
      for (let i = 0; i < 20; i++) chunks.push({ type: 'text-delta', id: 't', delta: `w${i} ` });
      chunks.push({ type: 'text-end', id: 't' }, { type: 'finish', finishReason: 'stop', usage });
    }
    return { stream: simulateReadableStream({ chunks, chunkDelayInMs: 0 }) };
  },
});

let observability;
if (mode !== 'off') {
  const { Observability, SamplingStrategyType } = await import('@mastra/observability');
  observability = new Observability({
    configs: {
      default: {
        serviceName: 'repro',
        sampling: { type: mode === 'always' ? SamplingStrategyType.ALWAYS : SamplingStrategyType.NEVER },
        ...(process.env.LOGGING === 'off' ? { logging: { enabled: false } } : {}),
        exporters: [{ name: 'noop', exportTracingEvent: async () => {}, flush: async () => {}, shutdown: async () => {} }],
      },
    },
  });
}

const agent = new Agent({ id: 'repro-agent', name: 'Repro agent', instructions: 'Call lookup once, then answer.', model, tools: { lookup } });
const mastra = new Mastra({ agents: { reproAgent: agent }, ...(observability ? { observability } : {}) });

// About 4 KB of span metadata.
const metadata = Object.fromEntries(Array.from({ length: Number(process.env.META_FIELDS ?? 40) }, (_, i) => [`field_${i}`, { value: `v${i}-${'m'.repeat(60)}`, tags: ['a', 'b', 'c'], n: i }]));

const runTurn = async () => {
  const out = await mastra.getAgent('reproAgent').stream('Look up rec-1 and summarise it.', { tracingOptions: { metadata }, maxSteps: 4 });
  let text = '';
  for await (const part of out.fullStream) if (part.type === 'text-delta') text += part.payload?.text ?? '';
  if (!text.startsWith('w0 ')) throw new Error('turn did not finish');
};

await runTurn(); // warm-up
const TURNS = 10;
calls = 0;
ms = 0;
for (let i = 0; i < TURNS; i++) await runTurn();
console.log(`${mode}: ${Math.round(calls / TURNS)} structuredClone calls per turn, ${(ms / TURNS).toFixed(1)} ms per turn`);
process.exit(0);
