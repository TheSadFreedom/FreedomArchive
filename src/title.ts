export function displayTitle(title: string): string {
  return title;
}

export function releaseYear(raw: string): number | null {
  const years = raw.match(/\b(?:18|19|20)\d{2}\b/g);
  if (!years || years.length === 0) return null;
  return Number(years[years.length - 1]);
}

const FILE_STEM_MAX = 72;
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Preview of the archive file stem: `Название (Год)` / `Название... (Год)`. */
export function fileStem(title: string, year: number): string {
  const suffix = ` (${year})`;
  const budget = Math.max(1, FILE_STEM_MAX - [...suffix].length);
  let safe = title
    .replace(FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  if (!safe) return `…${suffix}`;
  if ([...safe].length <= budget) return `${safe}${suffix}`;
  const take = Math.max(1, budget - 3);
  let cut = [...safe].slice(0, take).join("").replace(/[\s.]+$/g, "");
  if (!cut) cut = "…";
  return `${cut}...${suffix}`;
}
