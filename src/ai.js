import { settings, aiCall } from './store.js';

export function aiEnabled() {
  const s = settings();
  return !!(s.useAI && s.apiKey);
}

function stripFence(s) {
  return s.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
}

// page: { text, image(dataUrl) }  -> [{question, answer, hint, type}]
export async function aiCardsFromPage(page) {
  const s = settings();
  const content = [];
  if (page.image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: page.image.split(',')[1] },
    });
  }
  content.push({
    type: 'text',
    text:
      'This is one page of a math worksheet (geometry or algebra). Extract every distinct problem. ' +
      'For each, return the problem statement as "question", the fully worked final answer as "answer", ' +
      'and a one or two sentence "hint" that guides the student toward the method WITHOUT stating the answer. ' +
      'Also include a short "type" label (e.g. "Linear equation", "Area of triangle"). ' +
      'Reply with ONLY a JSON array, no prose. OCR text for reference:\n\n' +
      (page.text || '').slice(0, 6000),
  });

  const raw = await aiCall({
    apiKey: s.apiKey,
    model: s.model,
    system: 'You are a precise math teacher that outputs strict JSON.',
    content,
  });
  const arr = JSON.parse(stripFence(raw));
  return Array.isArray(arr) ? arr : [];
}

// Socratic hint that never reveals the answer.
export async function aiHint(card, level) {
  const s = settings();
  const ask =
    level >= 2
      ? 'Give a more specific next step, still without revealing or computing the final answer.'
      : 'Give a short first nudge about which method or formula to use. Do not reveal the answer.';
  const raw = await aiCall({
    apiKey: s.apiKey,
    model: s.model,
    system:
      'You are a patient math tutor. You never state the final answer. You ask a guiding question or ' +
      'point to the relevant concept, formula, or first step. Keep it to 1-3 sentences.',
    content: [
      {
        type: 'text',
        text:
          `Problem: ${card.question}\n` +
          (card.answer ? `(The answer, for your reference only, do NOT reveal it: ${card.answer})\n` : '') +
          `\n${ask}`,
      },
    ],
  });
  return raw.trim();
}
