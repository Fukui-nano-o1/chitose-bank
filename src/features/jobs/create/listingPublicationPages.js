// 第5弾: 募集者プロフィールの入力先。求人の44入力列・掲載同意記録は変更しない。
export const RECRUITER_FIELDS = Object.freeze({
  recruiter_name: { title: "募集者の氏名・名称", label: "氏名・名称", placeholder: "例：千歳農園", maxLength: 200 },
  recruiter_address: { title: "募集者の住所", label: "住所・所在地", placeholder: "例：徳島県吉野川市山川町123番地", maxLength: 500 },
  recruiter_contact: { title: "募集者の連絡先", label: "電話番号・メールアドレスなど", placeholder: "例：088-000-0000", maxLength: 200 },
  smoking_policy: { title: "受動喫煙の状況", label: "受動喫煙の状況" },
});
export const RECRUITER_PAGE_IDS = Object.freeze(Object.keys(RECRUITER_FIELDS));
export const isRecruiterPage = id => Object.hasOwn(RECRUITER_FIELDS, id);
export const recruiterKeys = id => id === "smoking_policy" ? ["smoking_policy", "smoking_area"] : isRecruiterPage(id) ? [id] : [];
const allowedKeys = [...RECRUITER_PAGE_IDS, "smoking_area"];
export const profileText = (profile, key) => typeof profile?.[key] === "string" ? profile[key].trim() : "";
// このデータはownerごとの端末下書きだけに保持する。DB求人ペイロードには混ぜない。
export function normalizeRecruiterDraft(input) {
  return Object.fromEntries(allowedKeys.filter(key => input?.[key] && typeof input[key].value === "string" && typeof input[key].base === "string")
    .map(key => [key, { value: input[key].value, base: input[key].base }]));
}
export function recruiterValues(profile, draft) {
  return Object.fromEntries(allowedKeys.map(key => [key, draft[key]?.value ?? profileText(profile, key)]));
}
export function missingRecruiterPages(profile, draft = {}) {
  return RECRUITER_PAGE_IDS.filter(id => !profileText(profile, id) || recruiterKeys(id).some(key => Object.hasOwn(draft, key)));
}
export const recruiterPageValid = (id, values) => isRecruiterPage(id) && !!profileText(values, id);
