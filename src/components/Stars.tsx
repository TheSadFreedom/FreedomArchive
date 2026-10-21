type StarsProps = {
  value: number;
  onChange?: (value: number) => void;
};

export function Stars({ value, onChange }: StarsProps) {
  const score = Math.max(0, Math.min(5, value));
  const label = score === 0 ? "без оценки" : `${score} из 5`;

  return (
    <span
      className={onChange ? "stars pick" : "stars"}
      role={onChange ? "radiogroup" : "img"}
      aria-label={label}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const lit = star <= score;
        const mark = (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 1.2 9.85 5.55l4.7.4-3.58 3.1 1.1 4.6L8 11.25 3.93 13.65l1.1-4.6L1.45 5.95l4.7-.4L8 1.2Z"
            />
          </svg>
        );
        if (!onChange) {
          return (
            <span key={star} className={lit ? "star on" : "star"}>
              {mark}
            </span>
          );
        }
        return (
          <button
            key={star}
            type="button"
            role="radio"
            className={lit ? "star on" : "star"}
            aria-checked={score === star}
            aria-label={`${star} из 5`}
            onClick={() => onChange(score === star ? 0 : star)}
          >
            {mark}
          </button>
        );
      })}
    </span>
  );
}
