import type { FieldDef } from "./categories";

const LIST_FIELDS = new Set(["genre", "themes", "theme", "actors"]);

const GENRE_ORDER = [
  "Сёнен",
  "Сёдзё",
  "Сэйнэн",
  "Дзёсэй",
  "Дзёсей",
  "Экшен",
  "Боевик",
  "Приключения",
  "RPG",
  "Открытый мир",
  "Комедия",
  "Драма",
  "Мелодрама",
  "Романтика",
  "Триллер",
  "Детектив",
  "Ужасы",
  "Криминал",
  "Фантастика",
  "Фэнтези",
  "Мистика",
  "Сверхъестественное",
  "Повседневность",
  "Психологическое",
  "Исторический",
  "Военное",
  "Меха",
  "Самураи",
  "Спорт",
  "Музыка",
  "Школа",
  "Биография",
  "Документальный",
  "Семейный",
  "Детский",
  "Глубокий сюжет",
];

const THEME_ORDER = [
  "Военное",
  "Выживание",
  "Жестокость",
  "Дружба",
  "Взросление",
  "Глубокий сюжет",
];

export function tagKey(tag: string): string {
  return tag.toLocaleLowerCase("ru");
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function byCatalog(items: string[], order: string[]): string[] {
  const rank = new Map(order.map((name, index) => [tagKey(name), index]));
  return items
    .map((item, index) => ({
      item,
      index,
      rank: rank.get(tagKey(item)) ?? order.length,
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.item);
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of items) {
    const key = tagKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

export function entryTags(fields: Record<string, string>): string[] {
  return [
    ...byCatalog(unique(list(fields.genre)), GENRE_ORDER),
    ...byCatalog(unique(list(fields.themes || fields.theme)), THEME_ORDER),
  ];
}

export type Facet = {
  key: string;
  label: string;
  values: string[];
};

function releaseYear(value: string): string | null {
  const years = value.match(/\b(?:18|19|20)\d{2}\b/g);
  return years ? years[years.length - 1] : null;
}

export function fieldValues(key: string, value: string | undefined): string[] {
  const raw = (value ?? "").trim();
  if (!raw) return [];
  if (key === "released") {
    const year = releaseYear(raw);
    return year ? [year] : [];
  }
  if (key === "actors") {
    return raw
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (key === "genre" || key === "themes" || key === "theme") return list(raw);
  return [raw];
}

function orderValues(key: string, values: string[]): string[] {
  const items = unique(values);
  if (key === "genre") return byCatalog(items, GENRE_ORDER);
  if (key === "themes" || key === "theme") return byCatalog(items, THEME_ORDER);
  if (key === "released") return items.sort((left, right) => Number(right) - Number(left));
  return items.sort((left, right) => left.localeCompare(right, "ru"));
}

export function orderedList(key: string, value: string | undefined): string[] {
  return orderValues(key, fieldValues(key, value));
}

export function collectFacets(
  fields: FieldDef[],
  entries: { fields: Record<string, string> }[],
): Facet[] {
  return fields
    .filter((field) => field.key !== "summary" && field.key !== "altTitle")
    .map((field) => ({
      key: field.key,
      label: field.key === "released" ? "Год выхода" : field.label,
      values: orderValues(
        field.key,
        entries.flatMap((entry) => fieldValues(field.key, entry.fields[field.key])),
      ),
    }))
    .filter((facet) => facet.values.length > 0);
}

export function matchesFacets(
  fields: Record<string, string>,
  selected: Record<string, string[]>,
): boolean {
  return Object.entries(selected).every(([key, picked]) => {
    if (picked.length === 0) return true;
    const values = new Set(fieldValues(key, fields[key]).map(tagKey));
    return LIST_FIELDS.has(key)
      ? picked.every((item) => values.has(item))
      : picked.some((item) => values.has(item));
  });
}
