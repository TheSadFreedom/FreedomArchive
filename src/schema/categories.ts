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
};

const altTitle: FieldDef = { key: "altTitle", label: "Альтернативное название", kind: "text" };

const released: FieldDef = { key: "released", label: "Дата выхода", kind: "text" };

const infoFields: FieldDef[] = [altTitle, released];

const queueSubs: Subcategory[] = [
  { id: "аниме", title: "Аниме", fields: infoFields },
  { id: "фильмы", title: "Фильмы", fields: infoFields },
  { id: "сериалы", title: "Сериалы", fields: infoFields },
  { id: "мультфильмы", title: "Мультфильмы", fields: infoFields },
  { id: "мультсериалы", title: "Мультсериалы", fields: infoFields },
  { id: "книги", title: "Книги", fields: infoFields },
];

export const RATINGS = [0, 1, 2, 3, 4, 5] as const;

export const categories: Category[] = [
  {
    id: "игры",
    title: "Игры",
    rated: false,
    subcategories: [
      { id: "пройдено", title: "Пройдено" },
      { id: "брошено", title: "Брошено" },
      { id: "условно", title: "Условно" },
      { id: "сыграно", title: "Сыграно" },
      { id: "мобильные", title: "Мобильные" },
      { id: "dlc", title: "DLC" },
      { id: "моды", title: "Моды" },
      { id: "ntfs", title: "NTFS" },
    ],
    fields: infoFields,
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

export function usesRating(categoryId: string | null | undefined): boolean {
  if (!categoryId) return true;
  return categoryById(categoryId)?.rated !== false;
}

export function placement(
  category: string,
  subcategory: string | null,
  rating: number,
): string {
  const parts = [category, subcategory];
  if (usesRating(category)) parts.push(String(rating));
  return parts.filter((part) => Boolean(part)).join("/");
}
