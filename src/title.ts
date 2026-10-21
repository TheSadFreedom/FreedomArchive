export function displayTitle(title: string): string {
  const match = title.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!match) return title;
  const main = match[1].trim();
  const alt = match[2].trim();
  if (!main || !alt) return title;
  return `${main} / ${alt}`;
}
