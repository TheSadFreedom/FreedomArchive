import { TIERS, tierLabel, tierOf, type Tier } from "../schema/categories";

type TierPickerProps = {
  value: number;
  onChange?: (value: number) => void;
  /** When true, tiers are visible but not editable. */
  locked?: boolean;
};

export function TierPicker({ value, onChange, locked = false }: TierPickerProps) {
  const score = Math.max(0, Math.min(TIERS.length, value));
  const current = tierOf(score);
  const label = tierLabel(score);
  const interactive = Boolean(onChange) && !locked;

  return (
    <span
      className={interactive ? "tiers pick" : locked ? "tiers locked" : "tiers"}
      role={interactive ? "radiogroup" : "img"}
      aria-label={label}
    >
      {TIERS.map((tier, index) => {
        const rating = index + 1;
        const on = current === tier;
        if (!interactive) {
          return (
            <span key={tier} className={on ? "tier on" : "tier"}>
              {tier}
            </span>
          );
        }
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            className={on ? "tier on" : "tier"}
            aria-checked={on}
            aria-label={`Tier ${tier}`}
            onClick={() => onChange?.(on ? 0 : rating)}
          >
            {tier}
          </button>
        );
      })}
    </span>
  );
}

export type { Tier };
