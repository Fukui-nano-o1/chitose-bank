import { sameProfileValue } from './profileRecord.js';

export const WORKER_SECTIONS = {
  nickname: ['nickname'], residence: ['residence_city'], transport: ['transport'], exp: ['farm_experience'],
  intensity: ['physical_level', 'work_mood', 'learning_pref', 'work_pattern'], interests: ['interests'], languages: ['languages'],
  declared: ['experience_entries', 'self_declared', 'experienced_tasks'],
};
export const EMPLOYER_SECTIONS = {
  nickname: ['nickname', 'recruiter_name', 'recruiter_name_kana'],
  place: ['recruiter_address', 'recruiter_zip', 'recruiter_prefecture', 'recruiter_city', 'recruiter_address_detail'],
  recruiter: ['recruiter_contact', 'consultation_contact', 'labor_insurance_status'],
  perks: ['has_transport', 'has_parking', 'has_commute_allowance', 'has_bonus', 'has_raise', 'has_severance_pay',
    'employer_pays_supplies', 'accessory_ok', 'parking_capacity', 'smoking_policy', 'smoking_area'],
  style: ['interaction_style', 'teaching_style', 'chat_style', 'question_style'],
};
export const EMPLOYER_TEXTS = {
  perks: ['transport_area', 'commute_allowance_detail', 'supplies_cap', 'raise_detail', 'bonus_detail', 'severance_detail'],
  intro: ['owner_comment', 'intro_path', 'intro_joy', 'intro_crops', 'intro_atmosphere', 'intro_message'],
  ask: ['unique_point', 'always_do', 'break_style'],
};
export function pickProfileFields(values, keys) { return Object.fromEntries(keys.map(k => [k, values[k]])); }
export function workerProfileChange(section, values, row) {
  if (WORKER_SECTIONS[section]) return { patch: pickProfileFields(values, WORKER_SECTIONS[section]) };
  const column = section === 'pr' ? 'pr' : section === 'qa' ? 'pr_qa' : null;
  if (!column) throw new Error('保存する項目を確認できません。');
  const value = values[column], pending = column + '_pending';
  const empty = column === 'pr' ? value === '' : value.length === 0;
  const current = row?.[pending] ?? row?.[column] ?? (column === 'pr' ? '' : []);
  const patch = sameProfileValue(current, value) ? {} : empty ? { [column]: value, [pending]: null } : { [pending]: value };
  // The existing DB trigger publishes pending text and applies the NG checks.
  return { patch, options: { guard: [column, pending], confirmed: { [column]: value } } };
}
export function employerProfileChange(section, values, texts, table, row) {
  const fields = EMPLOYER_SECTIONS[section] || [], textFields = EMPLOYER_TEXTS[section] || [];
  if (!fields.length && !textFields.length) throw new Error('保存する項目を確認できません。');
  const patch = pickProfileFields(values, fields), desired = pickProfileFields(texts, textFields);
  const changed = Object.fromEntries(Object.entries(desired).filter(([k, v]) => v !== (row?.texts_pending?.[k] ?? row?.[k] ?? '')));
  if (Object.keys(changed).length) {
    if (table === 'employer_profiles') patch.texts_pending = changed;
    else Object.assign(patch, changed);
  }
  return { patch, options: { guard: [...fields, ...textFields, ...(textFields.length ? ['texts_pending'] : [])], confirmed: { ...pickProfileFields(values, fields), ...desired } } };
}
