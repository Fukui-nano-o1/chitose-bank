import { HOST_STYLE_QUESTIONS, hostStyleValues } from '../../../lib/utils.js';

const text = value => typeof value === 'string' ? value.trim() : '';
const row = (title, body) => ({ title, body: text(body) });
const section = (id, title, rows) => ({ id, title, rows: rows.filter(item => item.body) });

// Explicit allowlist of existing job_employer_profile fields only. Never render
// texts_pending, contact details, addresses or arbitrary keys from a profile.
function styleLabels(employer, key) {
  const question = HOST_STYLE_QUESTIONS.find(item => item.k === key);
  return hostStyleValues(employer?.[key])
    .map(value => question?.options.find(option => option.value === value)?.label)
    .filter(Boolean).join('／');
}

export function workplaceSections(employer) {
  return [
    section('overview', '職場の概要', [
      row('農園の特徴', employer?.unique_point),
      row('育てている作物と想い', employer?.intro_crops),
    ]),
    section('environment', '働く環境', [
      row('作業中の雰囲気', styleLabels(employer, 'chat_style')),
      row('職場の雰囲気', employer?.intro_atmosphere),
    ]),
    // These booleans are the job's frozen perks returned by the existing RPC,
    // not live employer settings. Missing/false means omit, never infer absence.
    section('facilities', '設備・サポート', [
      row('駐車場', employer?.has_parking === true ? '駐車場あり' : ''),
      row('送迎', employer?.has_transport === true ? '送迎あり' : ''),
      row('作業用品', employer?.employer_pays_supplies === true ? '作業用品の費用を募集主が負担' : ''),
    ]),
    section('support', '教え方・関わり方', [
      row('作業中の関わり方', styleLabels(employer, 'interaction_style')),
      row('教え方', styleLabels(employer, 'teaching_style')),
      row('質問・相談のしかた', styleLabels(employer, 'question_style')),
    ]),
    section('practical', '働く前に知っておきたいこと', [
      row('働きに来た人に、いつもしていること', employer?.always_do),
      row('休憩の過ごし方', employer?.break_style),
    ]),
  ].filter(item => item.rows.length);
}

// The compact workplace preview and full page share a single field selection.
export function workplaceIntroRows(employer) {
  return workplaceSections(employer).flatMap(item => item.rows);
}

// Person-oriented prompts only. Workplace answers have one home above.
export function representativeQuestions(employer) {
  return [
    { q: '就農するまで', a: text(employer?.intro_path) },
    { q: 'いま楽しいこと', a: text(employer?.intro_joy) },
    { q: '初めての人へのメッセージ', a: text(employer?.intro_message) },
  ].filter(item => item.a);
}
