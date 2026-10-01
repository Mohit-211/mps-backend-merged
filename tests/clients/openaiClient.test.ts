import { OpenaiConfigError, createOpenaiClient } from '../../src/clients/openaiClient';
import { createFakeTransport, FakeStep } from '../helpers/fakeTransport';

// Phase 18: the OpenAI Responses client (fake transport; never the network).

const SENTINEL = 'sk-test-SENTINEL-not-a-key';
const format = { name: 'demo', schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false } };
const clientWith = (steps: FakeStep[], apiKey: string = SENTINEL) => {
	const fake = createFakeTransport(steps);
	return { fake, client: createOpenaiClient({ apiKey, model: 'gpt-5-nano', reasoningEffort: 'minimal', transport: fake.transport, sleep: async () => undefined }) };
};
const ok = (text: string, extra: Record<string, unknown> = {}) => ({
	status: 200,
	body: {
		model: 'gpt-5-nano-2025-08-07',
		status: 'completed',
		output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text }] }],
		usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 20 }, output_tokens: 40, output_tokens_details: { reasoning_tokens: 0 } },
		...extra,
	},
});

describe('openaiClient.respond', () => {
	it('posts a strict JSON-schema request (no stored state, minimal reasoning) and parses the answer and usage', async () => {
		const { client, fake } = clientWith([ok('{"a":"hi"}')]);
		const r = await client.respond<{ a: string }>({ instructions: 'Be brief.', input: '{"x":1}', format, maxOutputTokens: 100 });
		expect(r).toEqual({ data: { a: 'hi' }, model: 'gpt-5-nano-2025-08-07', usage: { input_tokens: 120, cached_input_tokens: 20, output_tokens: 40, reasoning_tokens: 0 }, attempts: 1 });
		const req = fake.requests[0];
		expect(req.url).toBe('https://api.openai.com/v1/responses');
		expect(req.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
		expect(req.data).toMatchObject({
			model: 'gpt-5-nano',
			instructions: 'Be brief.',
			input: '{"x":1}',
			max_output_tokens: 100,
			store: false,
			reasoning: { effort: 'minimal' },
			text: { format: { type: 'json_schema', name: 'demo', strict: true } },
		});
	});

	it('effort none omits the reasoning setting (non-reasoning models)', async () => {
		const fake = createFakeTransport([ok('{"a":"x"}')]);
		const client = createOpenaiClient({ apiKey: SENTINEL, reasoningEffort: 'none', transport: fake.transport });
		await client.respond({ instructions: 'i', input: 'x', format, maxOutputTokens: 50 });
		expect(fake.requests[0].data).not.toHaveProperty('reasoning');
	});

	it('fails clearly: no key, cut-off answers, refusals, invalid JSON, HTTP errors (one retry on 5xx)', async () => {
		await expect(createOpenaiClient({ apiKey: '', transport: createFakeTransport([]).transport }).respond({ instructions: 'i', input: 'x', format, maxOutputTokens: 10 })).rejects.toBeInstanceOf(OpenaiConfigError);
		await expect(clientWith([ok('{"a":', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })]).client.respond({ instructions: 'i', input: 'x', format, maxOutputTokens: 10 })).rejects.toMatchObject({ name: 'OpenaiError', usage: { output_tokens: 40 } });
		const refusal = { status: 200, body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }], usage: {} } };
		await expect(clientWith([refusal]).client.respond({ instructions: 'i', input: 'x', format, maxOutputTokens: 10 })).rejects.toThrow('refused');
		await expect(clientWith([ok('not json')]).client.respond({ instructions: 'i', input: 'x', format, maxOutputTokens: 10 })).rejects.toThrow('invalid JSON');
		const { client, fake } = clientWith([{ status: 500, body: { error: { message: 'boom' } } }, { status: 500, body: { error: { message: 'boom' } } }]);
		await expect(client.respond({ instructions: 'i', input: 'x', format, maxOutputTokens: 10 })).rejects.toMatchObject({ name: 'OpenaiError', status: 500, attempts: 2 });
		expect(fake.requests).toHaveLength(2);
	});
});
