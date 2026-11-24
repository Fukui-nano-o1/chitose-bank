// Only manipulate the exact, unambiguous fragment that the composer generated.
// A manually typed or edited phrase must not be mistaken for generated text.
export function planDraftSpan(text, plan) {
  if (!plan?.generated) return -1;
  const from = text.indexOf(plan.generated);
  return from >= 0 && from === text.lastIndexOf(plan.generated) ? from : -1;
}

export function replacePlanDraft(text, plan, reply) {
  const from = planDraftSpan(text, plan);
  if (from < 0) {
    const generated = reply ? (text && !/\s$/.test(text) ? ' ' : '') + reply : '';
    return { text: text + generated, generated };
  }
  const generated = reply ? (plan.generated.startsWith(' ') ? ' ' : '') + reply : '';
  return {
    text: text.slice(0, from) + generated + text.slice(from + plan.generated.length),
    generated,
  };
}
