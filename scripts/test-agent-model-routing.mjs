// The operator uses the configured agent model, keeps reasoning items next to
// their function calls (required by reasoning models) and falls back once to
// gpt-4.1-mini when the configured model is not available for the key.
import assert from 'node:assert/strict';
import { runAgent } from '../src/ai-agent.js';

const ctx = () => ({ surface: 'workbench', html: '<p style="background-color:#e9e9eb">Hi</p>', namespaces: [], pendingLocaleUpdates: [] });

// 1) reasoning item is passed back with the function call
{
  const bodies = [];
  globalThis.__OPENAI_TEST_MOCK = ({ body }) => {
    bodies.push(JSON.parse(JSON.stringify(body)));
    if (bodies.length === 1) {
      return { output: [
        { type: 'reasoning', id: 'rs_1', summary: [] },
        { type: 'function_call', call_id: 'c1', name: 'find_in_html', arguments: JSON.stringify({ query: 'background-color:#e9e9eb' }) },
      ] };
    }
    return { output: [{ type: 'function_call', call_id: 'c2', name: 'finish', arguments: JSON.stringify({ summary: 'done' }) }] };
  };
  await runAgent({ userMessage: 'test', ctx: ctx(), apiKey: 'x', model: 'gpt-5.4' });
  assert.equal(bodies[0].model, 'gpt-5.4');
  const second = bodies[1].input;
  const r = second.findIndex((i) => i.type === 'reasoning' && i.id === 'rs_1');
  const f = second.findIndex((i) => i.type === 'function_call' && i.call_id === 'c1');
  assert.ok(r >= 0 && f > r, 'reasoning item precedes its function_call in the next request');
}

// 2) unavailable model → one fallback to gpt-4.1-mini
{
  const models = [];
  globalThis.__OPENAI_TEST_MOCK = ({ body }) => {
    models.push(body.model);
    if (body.model === 'gpt-nope') throw new Error('The model `gpt-nope` does not exist or you do not have access to it.');
    return { output: [{ type: 'function_call', call_id: 'c3', name: 'finish', arguments: JSON.stringify({ summary: 'ok' }) }] };
  };
  const frames = [];
  await runAgent({ userMessage: 'test', ctx: ctx(), apiKey: 'x', model: 'gpt-nope', onFrame: (f) => frames.push(f) });
  assert.deepEqual(models, ['gpt-nope', 'gpt-4.1-mini']);
  assert.ok(frames.some((f) => f.kind === 'text' && /недоступна/.test(f.text)), 'the user is told about the fallback');
}
delete globalThis.__OPENAI_TEST_MOCK;
console.log('✓ agent model routing: reasoning items kept, fallback on unavailable model');
