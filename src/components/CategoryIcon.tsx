const icons: Record<string, string> = {
  аниме: "/icons/anime.svg",
  игры: "/icons/game.svg",
  манга: "/icons/manga.svg",
  кино: "/icons/film.svg",
  мульт: "/icons/mult.svg",
  стендап: "/icons/mocrophone.svg",
  книги: "/icons/book.svg",
  планы: "/icons/plans.png",
  ожидание: "/icons/wait.png",
  пересмотр: "/icons/rewatch.png",
  брошено: "/icons/dropped.png",
};

type CategoryIconProps = {
  id: string;
};

export function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4.2 10.4 12 4.2l7.8 6.2V20h-5.4v-5.2H9.6V20H4.2v-9.6Z"
      />
    </svg>
  );
}

export function CategoryIcon({ id }: CategoryIconProps) {
  const src = icons[id];
  if (!src) return <HomeIcon />;
  return <span className="rail-glyph" style={{ ["--glyph" as string]: `url("${src}")` }} />;
}
