export type Entry = {
  relativePath: string;
  title: string;
  category: string;
  subcategory: string | null;
  rating: number;
  fields: Record<string, string>;
  imagePath: string;
};
