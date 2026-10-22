import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { categoryById, fieldsFor, usesRating } from "../schema/categories";
import { orderedList } from "../schema/tags";
import { displayTitle } from "../title";
import type { Entry } from "../types";
import { Cover } from "./Cover";
import { Stars } from "./Stars";

type CardViewProps = {
  entry: Entry;
  onClose: () => void;
  onEdit: () => void;
};

const aboutTitle: Record<string, string> = {
  фильмы: "О фильме",
  мультфильмы: "О фильме",
  сериалы: "О сериале",
  мультсериалы: "О сериале",
  аниме: "Информация",
  игры: "Об игре",
  манга: "О манге",
};

function aboutHeading(category: string, subcategory: string | null | undefined): string {
  if (subcategory && aboutTitle[subcategory]) return aboutTitle[subcategory];
  return aboutTitle[category] ?? "Информация";
}

function people(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function CardView({ entry, onClose, onEdit }: CardViewProps) {
  const category = categoryById(entry.category);
  const sub = category?.subcategories?.find((item) => item.id === entry.subcategory);
  const fieldDefs = fieldsFor(entry.category, entry.subcategory);
  const filled = fieldDefs.filter((field) => (entry.fields[field.key] ?? "").trim());
  const summary = entry.fields.summary?.trim() ?? "";
  const actors = entry.fields.actors?.trim() ?? "";
  const cast = actors ? people(actors) : [];
  const themes = (entry.fields.themes || entry.fields.theme)?.trim() ?? "";
  const themeKey = entry.fields.themes?.trim() ? "themes" : "theme";
  const themeItems = themes ? orderedList(themeKey, themes) : [];
  const altTitle = entry.fields.altTitle?.trim() ?? "";
  const rows = filled.filter(
    (field) =>
      field.key !== "summary" &&
      field.key !== "actors" &&
      field.key !== "themes" &&
      field.key !== "theme" &&
      field.key !== "altTitle",
  );
  const heading = aboutHeading(entry.category, entry.subcategory);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    setZoomed(false);
  }, [entry.imagePath]);

  useEffect(() => {
    if (!zoomed) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setZoomed(false);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoomed]);

  return (
    <div className="card-page" role="dialog" aria-modal="true" aria-labelledby="view-title">
      <header className="card-page-bar">
        <button type="button" className="card-icon card-back" aria-label="Назад" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
            <path
              fill="currentColor"
              d="M14.8 5.2 8.1 12l6.7 6.8 1.5-1.5L11.1 12l5.2-5.3-1.5-1.5Z"
            />
          </svg>
        </button>
        <p className="add-kicker">{[category?.title, sub?.title].filter(Boolean).join(" · ")}</p>
      </header>

      <div className="card-page-body">
        <aside className="card-poster">
          <button
            type="button"
            className="card-cover-slot"
            aria-label="Увеличить обложку"
            onClick={() => setZoomed(true)}
          >
            <Cover imagePath={entry.imagePath} title={displayTitle(entry.title)} />
          </button>
          {zoomed && (
            <div className="cover-zoom" role="presentation" onClick={() => setZoomed(false)}>
              <img
                className="cover-zoom-image"
                src={convertFileSrc(entry.imagePath)}
                alt={displayTitle(entry.title)}
              />
            </div>
          )}
          {usesRating(entry.category) && (
            <div className="card-score">
              <Stars value={entry.rating} />
            </div>
          )}
        </aside>

        <div className="card-page-main">
          <div className="card-headline">
            <div className="card-names">
              <h2 id="view-title" className="card-name">
                {displayTitle(entry.title)}
              </h2>
              {altTitle && (
                <p className="card-alt" title="Альтернативное название">
                  {altTitle}
                </p>
              )}
            </div>
            <button type="button" className="card-icon" aria-label="Изменить" onClick={onEdit}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M3.8 16.7V20h3.3l9.8-9.8-3.3-3.3-9.8 9.8Zm14.8-8.6a.9.9 0 0 0 0-1.2l-2-2a.9.9 0 0 0-1.2 0l-1.5 1.5 3.3 3.3 1.4-1.6Z"
                />
              </svg>
            </button>
          </div>

          {(rows.length > 0 || cast.length > 0) && (
            <div className={cast.length > 0 ? "card-columns" : "card-columns solo"}>
              <section>
                <h3>{heading}</h3>
                <dl className="card-rows">
                  {rows.map((field) => (
                    <div key={field.key}>
                      <dt>{field.label}</dt>
                      <dd>{entry.fields[field.key]}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              {cast.length > 0 && (
                <section>
                  <h3>В главных ролях</h3>
                  <ul className="card-cast">
                    {cast.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        {(summary || themeItems.length > 0) && (
            <section className="card-about">
              {summary && (
                <>
                  <h3>Описание</h3>
                  <p className="card-summary">{summary}</p>
                </>
              )}
              {themeItems.length > 0 && (
                <div className={summary ? "card-themes" : undefined}>
                  <h3>{fieldDefs.find((field) => field.key === "themes" || field.key === "theme")?.label ?? "Темы"}</h3>
                  <div className="card-pills">
                    {themeItems.map((item) => (
                      <span key={item} className="card-pill">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
      </div>
    </div>
  );
}
