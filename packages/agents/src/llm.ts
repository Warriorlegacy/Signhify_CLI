import type { ModelProviderAdapter } from '@signhify/providers';
import type { SubagentContext } from './types.js';

/**
 * Real LLM output only when an adapter is wired and the offline path is not
 * forced (SIGNHIFY_MOCK_PROVIDER=1 or a mock adapter).
 */
export function shouldUseAdapter(
  ctx: SubagentContext | undefined,
): ctx is Required<Pick<SubagentContext, 'adapter'>> & SubagentContext {
  if (!ctx?.adapter) return false;
  if (process.env.SIGNHIFY_MOCK_PROVIDER === '1') return false;
  if (ctx.adapter.vendor === 'mock') return false;
  return true;
}

/** Collect the text of one adapter completion. Tools stay empty: subagents answer, they do not act. */
export async function completeWithAdapter(
  ctx: { adapter: ModelProviderAdapter; model?: string },
  system: string,
  user: string,
): Promise<string> {
  let out = '';
  for await (const chunk of ctx.adapter.streamChat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    tools: [],
    model: ctx.model ?? 'default',
    maxTokens: 1024,
  })) {
    if (chunk.type === 'text' && chunk.content) out += chunk.content;
  }
  return out.trim();
}
