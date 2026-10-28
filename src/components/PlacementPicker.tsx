import { CategoryIcon } from "./CategoryIcon";
import { categories, categoryById } from "../schema/categories";

const queueIds = new Set(["планы", "ожидание", "пересмотр", "брошено"]);

type PlacementPickerProps = {
  category: string;
  subcategory: string;
  onCategory: (id: string) => void;
  onSubcategory: (id: string) => void;
};

export function PlacementPicker({
  category,
  subcategory,
  onCategory,
  onSubcategory,
}: PlacementPickerProps) {
  const current = categoryById(category);
  const subs = current?.subcategories ?? [];
  const main = categories.filter((item) => !queueIds.has(item.id));
  const queues = categories.filter((item) => queueIds.has(item.id));
  const inQueue = queueIds.has(category);

  return (
    <div className="place-picker">
      <div className="place-panel">
        <div className="place-grid" role="group" aria-label="Категория">
          {main.map((item) => (
            <button
              key={item.id}
              type="button"
              className={category === item.id ? "place-tile on" : "place-tile"}
              aria-pressed={category === item.id}
              title={item.title}
              onClick={() => onCategory(item.id)}
            >
              <CategoryIcon id={item.id} />
              <span>{item.title}</span>
            </button>
          ))}
        </div>

        <div className="place-divider" aria-hidden="true" />

        <div className="place-queues" role="group" aria-label="Очереди">
          {queues.map((item) => (
            <button
              key={item.id}
              type="button"
              className={category === item.id ? "place-queue on" : "place-queue"}
              aria-pressed={category === item.id}
              title={item.title}
              onClick={() => onCategory(item.id)}
            >
              <CategoryIcon id={item.id} />
              <span>{item.title}</span>
            </button>
          ))}
        </div>
      </div>

      {subs.length > 0 && (
        <div className="place-subs" role="group" aria-label={inQueue ? "Тип" : "Подкатегория"}>
          {subs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={subcategory === item.id ? "place-sub on" : "place-sub"}
              aria-pressed={subcategory === item.id}
              onClick={() => onSubcategory(item.id)}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
