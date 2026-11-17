import { HOST_STYLE_QUESTIONS, hostStyleValues } from '../../../lib/utils.js';

const text = value => typeof value === 'string' ? value.trim() : '';

// Both workplace surfaces use the same public fields and known answer labels.
// Pending edits, contact details, addresses and arbitrary profile fields stay out.
function styleLabels(employer, key) {
  const question = HOST_STYLE_QUESTIONS.find(item => item.k === key);
  return hostStyleValues(employer?.[key])
    .map(value => question?.options.find(option => option.value === value)?.label)
    .filter(Boolean).join('／');
}

export function workplaceIntroRows(employer, { preview = false } = {}) {
  const atmosphere = { title: '職場の雰囲気', body: text(employer?.intro_atmosphere) };
  const teaching = { title: '教え方', body: styleLabels(employer, 'teaching_style') };
  const questions = { title: '質問・相談のしかた', body: styleLabels(employer, 'question_style') };
  const routines = { title: '働きに来た人に、いつもしていること', body: text(employer?.always_do) };
  const breaks = { title: '休憩の過ごし方', body: text(employer?.break_style) };
  // Surface practical working conditions in the compact job preview;
  // retain all published answers in their original order on the full page.
  if (preview) return [teaching, breaks, questions, atmosphere, routines].filter(row => row.body).slice(0, 2);
  return [atmosphere, teaching, questions, routines, breaks].filter(row => row.body);
}
