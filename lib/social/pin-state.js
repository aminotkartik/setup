/** Settle an optimistic moderator pin toggle against the committed RPC result. */
export function settlePostPin({ previous, requested, result }) {
  const confirmed = result?.result?.pinned;
  if (result?.ok === true && confirmed === requested) {
    return { ok: true, pinned: confirmed, error: null };
  }
  return {
    ok: false,
    pinned: previous,
    error: result?.error || 'The pin change was not confirmed. The previous state has been restored.',
  };
}
