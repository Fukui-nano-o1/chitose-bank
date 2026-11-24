import { EMPLOYER_SECTIONS, EMPLOYER_TEXTS } from './profileInput.js';
import { sameProfileValue } from './profileRecord.js';

// Each setting and its dependent detail are one edit, so a concurrent change
// to the detail cannot be silently discarded when the setting is turned off.
export const PERK_GROUPS = [
  ['送迎', 'has_transport', 'transport_area'],
  ['駐車場', 'has_parking', 'parking_capacity'],
  ['通勤手当', 'has_commute_allowance', 'commute_allowance_detail'],
  ['賞与', 'has_bonus', 'bonus_detail'],
  ['昇給', 'has_raise', 'raise_detail'],
  ['退職手当', 'has_severance_pay', 'severance_detail'],
  ['作業用品の負担', 'employer_pays_supplies', 'supplies_cap'],
  ['アクセサリーOK', 'accessory_ok'],
  ['受動喫煙対策', 'smoking_policy', 'smoking_area'],
];

const TEXT_FIELDS = new Set(EMPLOYER_TEXTS.perks);
const numericOrChoice = new Set(['parking_capacity', 'smoking_policy']);

export function readPerkValues(row) {
  const values = {};
  for (const key of EMPLOYER_SECTIONS.perks) {
    values[key] = row?.[key] ?? (numericOrChoice.has(key) ? null : key === 'smoking_area' ? '' : false);
  }
  for (const key of TEXT_FIELDS) values[key] = row?.texts_pending?.[key] ?? row?.[key] ?? '';
  return values;
}

// A detail hidden by its setting is not an edit just because the
// form represents it as blank. An intentional turn-off does clear it.
const inactive = (key, value) => key === 'smoking_policy' ? value !== '喫煙場所あり' : !value;
const emptyDetail = key => key === 'parking_capacity' ? null : '';
export function perkIntent(row, draft) {
  const base = readPerkValues(row), intent = {};
  for (const [, key, detail] of PERK_GROUPS) {
    const changed = !sameProfileValue(base[key], draft[key]);
    if (changed) intent[key] = draft[key];
    if (detail && ((changed && inactive(key, draft[key])) ||
        (!inactive(key, draft[key]) && !sameProfileValue(base[detail], draft[detail])))) {
      intent[detail] = draft[detail];
    }
  }
  return intent;
}

export function perkReview(row, intent) {
  const current = readPerkValues(row), drafts = { ...current, ...intent };
  const groups = PERK_GROUPS.filter(([, ...keys]) => keys.some(key => Object.hasOwn(intent, key)));
  // If another edit turned off a setting, a detail-only draft must not
  // silently re-enable it (or save hidden text). Let the user edit instead.
  const needsEditing = groups.some(([, key, detail]) => detail && Object.hasOwn(intent, detail)
    && !Object.hasOwn(intent, key) && inactive(key, current[key])
    && !sameProfileValue(intent[detail], emptyDetail(detail)));
  const hasOtherPending = Object.keys(row?.texts_pending ?? {}).some(key => !Object.hasOwn(intent,key) || !TEXT_FIELDS.has(key));
  return { current, drafts, groups, needsEditing, hasOtherPending };
}

export function samePerkReview(previous, current, intent) {
  const before = perkReview(previous, intent), after = perkReview(current, intent);
  return before.groups.every(([, ...keys]) => keys.every(key => sameProfileValue(before.current[key],after.current[key])))
    && sameProfileValue(previous?.texts_pending ?? {},current?.texts_pending ?? {});
}

export function perkSaveChange(row, intent) {
  const { groups, drafts, needsEditing, hasOtherPending, current } = perkReview(row, intent);
  const patch = {}, pending = {}, confirmed = {}, guard = [];
  if (needsEditing) throw Object.assign(new Error('待遇の保存条件が変わりました。'), { code:'PROFILE_CONFLICT' });
  if (!groups.length) return { patch, options: { guard, confirmed:current } };
  for (const [, ...keys] of groups) {
    let groupChanged = false;
    for (const key of keys) {
      if (!Object.hasOwn(intent, key)) continue;
      confirmed[key] = drafts[key];
      const isText = TEXT_FIELDS.has(key);
      const saved = isText ? row?.[key] ?? '' : current[key];
      if (!sameProfileValue(saved, drafts[key])) {
        groupChanged = true;
        (isText ? pending : patch)[key] = drafts[key];
      }
    }
    if (groupChanged) guard.push(...keys);
  }
  if (Object.keys(pending).length) patch.texts_pending = pending;
  if (Object.keys(patch).length) {
    // The trigger publishes the whole pending map on update. Do not publish
    // or drop other sections' pending text, including if it arrives in flight.
    if (hasOtherPending) throw Object.assign(new Error('別のプロフィール項目の入力が処理待ちです。'), { code:'PROFILE_CONFLICT' });
    guard.push('texts_pending');
  }
  return { patch, options: { guard, confirmed } };
}

export function overlayPerkIntent(row, intent) {
  const result = { ...row, ...intent, texts_pending: { ...row?.texts_pending } };
  for (const key of TEXT_FIELDS) {
    if (Object.hasOwn(intent, key)) delete result.texts_pending[key];
  }
  return result;
}
