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

const summary: FieldDef = { key: "summary", label: "Краткое описание", kind: "textarea" };

const altTitle: FieldDef = { key: "altTitle", label: "Альтернативное название", kind: "text" };

const genre: FieldDef = { key: "genre", label: "Жанр", kind: "text" };

const franchise: FieldDef = { key: "franchise", label: "Франшиза", kind: "text" };

const screenFields: FieldDef[] = [
  summary,
  altTitle,
  genre,
  { key: "released", label: "Дата выхода", kind: "text" },
  { key: "country", label: "Страна", kind: "text" },
  { key: "runtime", label: "Время", kind: "text" },
  { key: "ageRating", label: "Возрастной рейтинг", kind: "text" },
  { key: "mpaa", label: "Возрастной рейтинг MPAA", kind: "text" },
  { key: "director", label: "Режиссёр", kind: "text" },
  { key: "screenplay", label: "Сценарий", kind: "text" },
  { key: "producer", label: "Продюсер", kind: "text" },
  { key: "actors", label: "Актёры", kind: "textarea" },
  { key: "studio", label: "Студия", kind: "text" },
  franchise,
  { key: "budget", label: "Бюджет", kind: "text" },
  { key: "boxOffice", label: "Сборы", kind: "text" },
];

const summaryAndYear: FieldDef[] = [
  summary,
  { key: "year", label: "Год", kind: "number" },
];

const seriesFields: FieldDef[] = (() => {
  const episodes: FieldDef = { key: "episodes", label: "Количество серий", kind: "number" };
  const runtimeAt = screenFields.findIndex((field) => field.key === "runtime");
  return [
    ...screenFields.slice(0, runtimeAt + 1),
    episodes,
    ...screenFields.slice(runtimeAt + 1),
  ];
})();

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
    fields: [
      summary,
      genre,
      { key: "theme", label: "Тема", kind: "text" },
      { key: "released", label: "Дата выхода", kind: "text" },
      { key: "developer", label: "Разработчик", kind: "text" },
      { key: "publisher", label: "Издатель", kind: "text" },
      franchise,
    ],
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
    fields: [
      summary,
      altTitle,
      genre,
      { key: "released", label: "Дата выхода", kind: "text" },
      { key: "country", label: "Страна", kind: "text" },
      { key: "episodes", label: "Эпизоды", kind: "number" },
      { key: "duration", label: "Длительность", kind: "text" },
      { key: "ageRating", label: "Возрастной рейтинг", kind: "text" },
      { key: "origin", label: "Первоисточник", kind: "text" },
      { key: "studio", label: "Студия", kind: "text" },
      { key: "director", label: "Режиссёр", kind: "text" },
      franchise,
    ],
  },
  {
    id: "манга",
    title: "Манга",
    subcategories: [
      { id: "манга", title: "Манга" },
      { id: "хентай", title: "Хентай" },
    ],
    fields: [
      summary,
      altTitle,
      genre,
      { key: "kind", label: "Тип", kind: "text" },
      { key: "released", label: "Дата", kind: "text" },
      { key: "chapters", label: "Количество глав", kind: "number" },
      franchise,
    ],
  },
  {
    id: "кино",
    title: "Кино",
    subcategories: [
      { id: "фильмы", title: "Фильмы", fields: screenFields },
      { id: "сериалы", title: "Сериалы", fields: seriesFields },
    ],
    fields: screenFields,
  },
  {
    id: "мульт",
    title: "Мульт",
    subcategories: [
      { id: "мультфильмы", title: "Мультфильмы", fields: screenFields },
      { id: "мультсериалы", title: "Мультсериалы", fields: seriesFields },
    ],
    fields: screenFields,
  },
  {
    id: "стендап",
    title: "Стендап",
    fields: [...summaryAndYear],
  },
  {
    id: "книги",
    title: "Книги",
    fields: [
      summary,
      { key: "author", label: "Автор", kind: "text" },
      { key: "year", label: "Год", kind: "number" },
      { key: "pages", label: "Страниц", kind: "number" },
      franchise,
    ],
  },
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
