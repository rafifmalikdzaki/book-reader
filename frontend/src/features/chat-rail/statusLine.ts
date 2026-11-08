import type { ChatStatus } from '../../api/types';

/** Status text for the rail header line (port of chat.js `loadStatus`). */
export function statusText(status: ChatStatus | undefined, failed: boolean): string {
  if (failed) return 'Chat status unavailable.';
  if (!status) return '…';
  if (!status.available) {
    return status.reason || 'Chat is not configured — add a provider key.';
  }
  const selected = status.selected || 'auto';
  if (selected === 'auto') {
    const chain = status.providers.map((model) => `${model.provider} · ${model.model}`);
    return chain.length ? `Auto: ${chain.join(' → ')}` : 'Auto';
  }
  return `Model: ${selected}`;
}
