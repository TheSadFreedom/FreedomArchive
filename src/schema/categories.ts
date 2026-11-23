export type FieldKind = "text" | "textarea" | "number";

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
};

export type Subcategory = {
  id: string;
  title: string;
  fields?: FieldDef[];
};

export type Category = {
  id: string;
  title: string;
  subcategories?: Subcategory[];
  fields: FieldDef[];
  rated?: boolean;
  /** Game tiers F→S instead of star ratings. */
  tiered?: boolean;
};

const altTitle: FieldDef = { key: "altTitle", label: "Альтернативное название", kind: "text" };

const released: FieldDef = { key: "released", label: "Дата выхода", kind: "text" };

const playtime: FieldDef = { key: "playtime", label: "Время прохождения", kind: "text" };

const infoFields: FieldDef[] = [altTitle, released];

const gameFields: FieldDef[] = [...infoFields, playtime];

const queueSubs: Subcategory[] = [
  { id: "аниме", title: "Аниме", fields: infoFields },
  { id: "фильмы", title: "Фильмы", fields: infoFields },
  { id: "сериалы", title: "Сериалы", fields: infoFields },
  { id: "мультфильмы", title: "Мультфильмы", fields: infoFields },
  { id: "мультсериалы", title: "Мультсериалы", fields: infoFields },
  { id: "книги", title: "Книги", fields: infoFields },
];

export const RATINGS = [0, 1, 2, 3, 4, 5] as const;

/** Ascending quality: F < E < D < C < B < A < S. Stored rating is 1…7; 0 = none. */
export const TIERS = ["F", "E", "D", "C", "B", "A", "S"] as const;
export type Tier = (typeof TIERS)[number];

export const categories: Category[] = [
  {
    id: "игры",
    title: "Игры",
    rated: false,
    tiered: true,
    subcategories: [
      { id: "сюжетные", title: "Сюжетные" },
      { id: "без сюжета", title: "Без Сюжета" },
      { id: "условно", title: "Условно" },
      { id: "моды", title: "Моды" },
      { id: "dlc", title: "DLC" },
      { id: "брошено", title: "Брошено" },
    ],
    fields: gameFields,
  },
  {
    id: "аниме",
    title: "Аниме",
    subcategories: [
      { id: "сериалы", title: "Сериалы" },
      { id: "фильмы", title: "Фильмы" },
      { id: "ova", title: "OVA" },
      { id: "хентай", title: "Хентай" },
    ],
    fields: infoFields,
  },
  {
    id: "манга",
    title: "Манга",
    subcategories: [
      { id: "манга", title: "Манга" },
      { id: "хентай", title: "Хентай" },
    ],
    fields: infoFields,
  },
  {
    id: "кино",
    title: "Кино",
    subcategories: [
      { id: "фильмы", title: "Фильмы" },
      { id: "сериалы", title: "Сериалы" },
    ],
    fields: infoFields,
  },
  {
    id: "мульт",
    title: "Мульт",
    subcategories: [
      { id: "мультфильмы", title: "Мультфильмы" },
      { id: "мультсериалы", title: "Мультсериалы" },
    ],
    fields: infoFields,
  },
  {
    id: "стендап",
    title: "Стендап",
    fields: infoFields,
  },
  {
    id: "книги",
    title: "Книги",
    fields: infoFields,
  },
  ...[
    { id: "планы", title: "Планы" },
    { id: "ожидание", title: "Ожидание" },
    { id: "пересмотр", title: "Пересмотр" },
    { id: "брошено", title: "Брошено" },
  ].map(
    (item): Category => ({
      id: item.id,
      title: item.title,
      rated: false,
      subcategories: queueSubs,
      fields: infoFields,
    }),
  ),
];

export function categoryById(id: string): Category | undefined {
  return categories.find((category) => category.id === id);
}

export function fieldsFor(categoryId: string | null | undefined, subcategoryId?: string | null): FieldDef[] {
  const category = categoryId ? categoryById(categoryId) : undefined;
  if (!category) return [];
  const sub = category.subcategories?.find((item) => item.id === subcategoryId);
  return sub?.fields ?? category.fields;
}

export function ratingLabel(rating: number): string {
  return rating === 0 ? "без оценки" : `${rating} из 5`;
}

export function tierOf(rating: number): Tier | null {
  if (rating < 1 || rating > TIERS.length) return null;
  return TIERS[rating - 1];
}

export function tierFolder(rating: number): string {
  return tierOf(rating) ?? "0";
}

export function tierLabel(rating: number): string {
  const tier = tierOf(rating);
  return tier ? `Tier ${tier}` : "без тира";
}

export function usesRating(categoryId: string | null | undefined): boolean {
  if (!categoryId) return true;
  const category = categoryById(categoryId);
  if (!category || category.tiered) return false;
  return category.rated !== false;
}

export function usesTier(categoryId: string | null | undefined): boolean {
  if (!categoryId) return false;
  return categoryById(categoryId)?.tiered === true;
}

export function usesScore(categoryId: string | null | undefined): boolean {
  return usesRating(categoryId) || usesTier(categoryId);
}

export function placement(
  category: string,
  subcategory: string | null,
  rating: number,
): string {
  const parts = [category, subcategory];
  if (usesTier(category)) parts.push(tierFolder(rating));
  else if (usesRating(category)) parts.push(String(rating));
  return parts.filter((part) => Boolean(part)).join("/");
}

/** Tier F is always linked to the dropped games shelf. */
export const GAME_DROPPED_SUB = "брошено";
export const GAME_TIER_F = 1;

export function isGameNtfs(fields: Record<string, string> | undefined): boolean {
  return (fields?.ntfs ?? "").trim() === "1";
}

export type NtfsFilter = "on" | "off" | "only";
