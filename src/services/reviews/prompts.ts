import { JsonSchemaFormat } from '../../clients/openaiClient';

// Prompts and output schemas for the review AI tasks (Phase 18). Short fixed instructions, compact JSON
// input, strict JSON output: the cheapest way to get usable answers from a small model.

export const REPLY_INSTRUCTIONS = `You write owner replies to Google reviews for a local business.
Rules:
- Reply in the review's language. 1-3 short sentences, under 60 words.
- Sound like a real person at this business: warm, specific, plain. Mention something the reviewer actually said when there is something.
- Never invent facts, offers, names of staff or details not in the review.
- Keywords are optional context: use at most one, only if it fits naturally. Never stuff keywords.
- No templated openings like "Thank you for your kind words" in every reply; vary wording across the batch.
- If a first name is given you may greet with it. No emojis, no hashtags, no links, no phone numbers.
Return one reply per review id.`;

export const replyFormat: JsonSchemaFormat = {
	name: 'review_replies',
	schema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			replies: {
				type: 'array',
				items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, reply: { type: 'string' } }, required: ['id', 'reply'] },
			},
		},
		required: ['replies'],
	},
};

export const ANALYSIS_INSTRUCTIONS = `You help a local business owner triage Google reviews. For each review give:
- sentiment: positive, neutral, negative or mixed
- severity: low, medium or high (high = safety, legal, discrimination, threats or a serious service failure)
- suspicious_indicators: short phrases for signs the review may break Google's review policies (spam, off-topic, conflict of interest, offensive language, personal information, harassment). Empty when none. Never call a review fake; describe indicators only.
- summary: one short sentence on what the reviewer says
- recommended_action: one short sentence (e.g. reply publicly and offer to talk; report to Google as off-topic; no action needed)
Base everything only on the text and rating given.`;

export const analysisFormat: JsonSchemaFormat = {
	name: 'review_analysis',
	schema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			results: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					properties: {
						id: { type: 'string' },
						sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'mixed'] },
						severity: { type: 'string', enum: ['low', 'medium', 'high'] },
						suspicious_indicators: { type: 'array', items: { type: 'string' } },
						summary: { type: 'string' },
						recommended_action: { type: 'string' },
					},
					required: ['id', 'sentiment', 'severity', 'suspicious_indicators', 'summary', 'recommended_action'],
				},
			},
		},
		required: ['results'],
	},
};

/** Google's prohibited and restricted content categories a review report can cite. */
export const POLICY_REASONS = ['spam', 'off_topic', 'conflict_of_interest', 'offensive', 'harassment', 'hate_speech', 'personal_information', 'restricted_content', 'none_applies'] as const;
export type PolicyReason = (typeof POLICY_REASONS)[number];

export const APPEAL_INSTRUCTIONS = `You help a business owner ask Google to remove a review that may break Google's review policies.
Pick the single best policy_reason from the list. If nothing clearly applies, use none_applies and say plainly in report_text that the review probably does not break Google's policies and a public reply is the better response.
Otherwise write report_text: 60-120 words, factual and calm, addressed to Google's review team. Quote or describe the specific part of the review that breaks the policy and why. No insults, no speculation about who wrote it, no claims you cannot support from the review and the indicators given. Do not call the review fake; describe indicators.`;

export const appealFormat: JsonSchemaFormat = {
	name: 'review_appeal',
	schema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			policy_reason: { type: 'string', enum: [...POLICY_REASONS] },
			report_text: { type: 'string' },
		},
		required: ['policy_reason', 'report_text'],
	},
};

export const INSIGHTS_INSTRUCTIONS = `You summarise Google reviews for a local business owner. From the counts and the review excerpts, give:
- themes: up to 6 recurring topics with how many excerpts mention them and their overall sentiment
- praise: up to 4 short points customers like
- complaints: up to 4 short recurring problems (only ones that appear more than once, or are serious)
- observations: up to 3 short operational observations (trends over time, rating changes)
Be concrete and brief. Base everything only on the data given.`;

export const insightsFormat: JsonSchemaFormat = {
	name: 'review_insights',
	schema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			themes: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					properties: { theme: { type: 'string' }, mentions: { type: 'integer' }, sentiment: { type: 'string', enum: ['positive', 'negative', 'mixed'] } },
					required: ['theme', 'mentions', 'sentiment'],
				},
			},
			praise: { type: 'array', items: { type: 'string' } },
			complaints: { type: 'array', items: { type: 'string' } },
			observations: { type: 'array', items: { type: 'string' } },
		},
		required: ['themes', 'praise', 'complaints', 'observations'],
	},
};

/** Google's Reviews Management Tool, where reports and the one-time appeal are submitted by hand. */
export const GOOGLE_REVIEW_REPORT_URL = 'https://support.google.com/business/workflow/16726127';
