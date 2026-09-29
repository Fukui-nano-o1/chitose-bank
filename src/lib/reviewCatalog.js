// 選択肢・保存キー・管理画面・公開集計ラベルの共通定義。既存キーは変更しない。
export const WORK_REVIEW_POINTS = [
  { key:'as_described', group:'仕事内容・準備', category:'仕事内容', column:true, positive:'求人の内容どおりだった', negative:'求人の内容と違いがあった' },
  { key:'meeting_clear', group:'仕事内容・準備', category:'集合の案内', positive:'集合場所の案内が分かりやすかった', negative:'集合場所の案内が分かりにくかった' },
  { key:'tools_ready', group:'仕事内容・準備', category:'道具の準備', positive:'必要な道具が用意されていた', negative:'必要な道具の準備が足りなかった' },
  { key:'changes_shared', group:'仕事内容・準備', category:'変更の連絡', positive:'予定の変更を事前に知らせてくれた', negative:'予定の変更の連絡が遅かった' },
  { key:'instructions_clear', group:'説明・相談', category:'説明・教え方', column:true, positive:'説明・教え方が分かりやすかった', negative:'説明・教え方が分かりにくかった' },
  { key:'demonstration', group:'説明・相談', category:'作業の実演', positive:'作業の見本を見せてくれた', negative:'作業の見本が足りなかった' },
  { key:'questions_welcome', group:'説明・相談', category:'質問のしやすさ', positive:'質問や相談をしやすかった', negative:'質問や相談をしにくかった' },
  { key:'respectful', group:'説明・相談', category:'言葉づかい', positive:'相手を尊重した声かけだった', negative:'言葉づかいや声かけに配慮が足りなかった' },
  { key:'safety_care', group:'安全・体調', category:'安全・休憩', column:true, positive:'安全や休憩への配慮があった', negative:'安全や休憩への配慮が足りなかった' },
  { key:'hazards_explained', group:'安全・体調', category:'危険箇所の説明', positive:'危険な場所や作業の説明があった', negative:'危険な場所や作業の説明が足りなかった' },
  { key:'heat_care', group:'安全・体調', category:'暑さ・寒さ対策', positive:'暑さや寒さへの対策があった', negative:'暑さや寒さへの対策が足りなかった' },
  { key:'rest_water', group:'安全・体調', category:'休憩・水分補給', positive:'休憩や水分補給を取りやすかった', negative:'休憩や水分補給を取りにくかった' },
  { key:'paid_as_posted', group:'報酬・時間', category:'報酬', column:true, positive:'報酬が約束どおりだった', negative:'報酬が約束どおりではなかった' },
  { key:'hours_kept', group:'報酬・時間', category:'作業時間', positive:'約束した作業時間が守られた', negative:'約束した作業時間と違いがあった' },
  { key:'payment_clear', group:'報酬・時間', category:'支払いの説明', positive:'支払いの説明が分かりやすかった', negative:'支払いの説明が分かりにくかった' },
  { key:'workload_fit', group:'報酬・時間', category:'作業量', positive:'経験や体力に合う作業量だった', negative:'経験や体力に対して作業量が多かった' },
  { key:'want_again', group:'環境・次回', category:'次回の仕事', column:true, positive:'またこの農家で働きたい', negative:'また働きたいとは思わなかった' },
  { key:'facilities', group:'環境・次回', category:'トイレ・手洗い', positive:'トイレや手洗い場を利用しやすかった', negative:'トイレや手洗い場を利用しにくかった' },
  { key:'team_atmosphere', group:'環境・次回', category:'職場の雰囲気', positive:'周りの人と協力しやすかった', negative:'周りの人と協力しにくかった' },
  { key:'learning_support', group:'環境・次回', category:'学ぶ機会', positive:'新しい作業を学ぶ機会があった', negative:'慣れない作業への支援が足りなかった' },
];

export const FARMER_REVIEW_POINTS = [
  { key:'careful', group:'作業の進め方', positiveTag:'careful', negativeTag:'work_issue', positive:'丁寧だった', negative:'作業に問題があった' },
  { key:'fast', group:'作業の進め方', positiveTag:'fast', negativeTag:'pace_issue', positive:'作業が早かった', negative:'作業のペースに改善が必要だった' },
  { key:'quality', group:'作業の進め方', positiveTag:'quality', negativeTag:'quality_issue', positive:'仕上がりが安定していた', negative:'仕上がりにばらつきがあった' },
  { key:'crop_handling', group:'作業の進め方', positiveTag:'crop_handling', negativeTag:'crop_handling_issue', positive:'作物や商品を大切に扱った', negative:'作物や商品の扱いに改善が必要だった' },
  { key:'attentive', group:'確認・報告・相談', positiveTag:'attentive', negativeTag:'instruction_issue', positive:'指示をよく確認した', negative:'作業前の指示確認が足りなかった' },
  { key:'questions', group:'確認・報告・相談', positiveTag:'questions', negativeTag:'questions_issue', positive:'分からないことを質問した', negative:'分からないまま作業を進めた' },
  { key:'progress', group:'確認・報告・相談', positiveTag:'progress', negativeTag:'progress_issue', positive:'進み具合をこまめに報告した', negative:'進み具合の報告が足りなかった' },
  { key:'communication', group:'確認・報告・相談', positiveTag:'communication', negativeTag:'comm_issue', positive:'連絡や相談が分かりやすかった', negative:'コミュニケーションに問題があった' },
  { key:'punctual', group:'時間・準備', positiveTag:'punctual', negativeTag:'time_issue', positive:'約束の時間を守った', negative:'約束の時間を守れなかった' },
  { key:'prepared', group:'時間・準備', positiveTag:'prepared', negativeTag:'preparation_issue', positive:'持ち物や服装の準備ができていた', negative:'持ち物や服装の準備が足りなかった' },
  { key:'schedule_contact', group:'時間・準備', positiveTag:'schedule_contact', negativeTag:'schedule_contact_issue', positive:'予定の変更を早めに連絡した', negative:'予定の変更の連絡が遅かった' },
  { key:'responsible', group:'時間・準備', positiveTag:'responsible', negativeTag:'responsibility_issue', positive:'担当した作業を最後まで進めた', negative:'担当した作業を途中で放置した' },
  { key:'safe', group:'安全・片づけ', positiveTag:'safe', negativeTag:'safety_issue', positive:'安全に作業した', negative:'安全上の注意が守られなかった' },
  { key:'tools', group:'安全・片づけ', positiveTag:'tools', negativeTag:'tools_issue', positive:'道具を正しく大切に使った', negative:'道具の使い方や扱いに問題があった' },
  { key:'cleanup', group:'安全・片づけ', positiveTag:'cleanup', negativeTag:'cleanup_issue', positive:'片づけや清掃まで行った', negative:'片づけや清掃が足りなかった' },
  { key:'hygiene', group:'安全・片づけ', positiveTag:'hygiene', negativeTag:'hygiene_issue', positive:'衛生上のルールを守った', negative:'衛生上のルールが守られなかった' },
  { key:'teamwork', group:'協力・学習', positiveTag:'teamwork', negativeTag:'teamwork_issue', positive:'周りと協力して作業した', negative:'周りとの連携が足りなかった' },
  { key:'considerate', group:'協力・学習', positiveTag:'considerate', negativeTag:'respect_issue', positive:'周りへの気づかいがあった', negative:'周りへの声かけや配慮が足りなかった' },
  { key:'learning', group:'協力・学習', positiveTag:'learning', negativeTag:'learning_issue', positive:'教わったことを作業に活かした', negative:'確認した手順が作業に反映されなかった' },
  { key:'adaptable', group:'協力・学習', positiveTag:'adaptable', negativeTag:'adaptation_issue', positive:'作業の変更に柔軟に対応した', negative:'作業の変更への対応に困った' },
].map(point => ({ ...point, category:point.positive }));

export const workReviewTag = (key, polarity) => `job_${key}_${polarity === 'positive' ? 'good' : 'improve'}`;
export const FARMER_TRAIT_TAGS = {
  label:'選んだ評価項目', points:FARMER_REVIEW_POINTS,
  options:FARMER_REVIEW_POINTS.flatMap(point => [
    { v:point.positiveTag, l:point.positive }, { v:point.negativeTag, l:point.negative, negative:true },
  ]),
};
export const detailReviewTags = direction => direction === 'farmer_to_worker' ? FARMER_TRAIT_TAGS.options
  : WORK_REVIEW_POINTS.filter(point => !point.column).flatMap(point => [
    { v:workReviewTag(point.key, 'positive'), l:point.positive },
    { v:workReviewTag(point.key, 'negative'), l:point.negative, negative:true },
  ]);
