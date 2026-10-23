// 単一の判断を同じ選択カードで表示する。入力の保持先は親の掲載フォーム。
export function ListingChoiceCards({ label, options, value, onChange }) {
  const choices = value && !options.includes(value) ? [...options, value] : options;
  return <div className="listing-condition-choices listing-topic-choices" role="group" aria-label={label}>
    {choices.map(option => <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>
      <span>{option}</span><span aria-hidden="true" className="listing-condition-radio" />
    </button>)}
  </div>;
}
