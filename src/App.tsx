import { useCallback, useEffect, useMemo, useState } from "react";
import { errorText, listEntries } from "./api";
import { AddDialog } from "./components/AddDialog";
import { CatalogMenu, DeleteDialog, MoveDialog } from "./components/CatalogMenu";
import { CardDialog } from "./components/CardDialog";
import { CategoryIcon, HomeIcon } from "./components/CategoryIcon";
import { Cover } from "./components/Cover";
import { CoverZoom } from "./components/CoverZoom";
import { HomeDrift } from "./components/HomeDrift";
import {
  categories,
  categoryById,
  usesRating,
} from "./schema/categories";
import {
  compareEntries,
  defaultSortDir,
  type SortDir,
  type SortKey,
} from "./schema/sort";
import type { Entry } from "./types";
import { displayTitle, releaseYear } from "./title";
import "./App.css";

const bottomMenu = new Set(["планы", "ожидание", "пересмотр", "брошено"]);

function recordsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "запись";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "записи";
  return "записей";
}

function byTitle(left: Entry, right: Entry): number {
  return displayTitle(left.title).localeCompare(displayTitle(right.title), "ru");
}

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [homeQuery, setHomeQuery] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [movingPath, setMovingPath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategory, setSubcategory] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const reload = useCallback(async (nextPath?: string) => {
    const next = await listEntries();
    setEntries(next);
    setSelectedPath((current) => {
      const preferred = nextPath === undefined ? current : nextPath;
      return preferred && next.some((entry) => entry.relativePath === preferred)
        ? preferred
        : null;
    });
  }, []);

  useEffect(() => {
    let active = true;
    listEntries()
      .then((next) => {
        if (active) setEntries(next);
      })
      .catch((caught) => {
        if (active) setError(errorText(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setAdding(false);
      if (editing) {
        setEditing(false);
        setSelectedPath(null);
      } else if (selectedPath) {
        setSelectedPath(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, selectedPath]);

  const current = categoryId ? categoryById(categoryId) : undefined;
  const subs = current?.subcategories ?? [];
  const filterSub =
    subs.length === 0
      ? null
      : subs.some((item) => item.id === subcategory)
        ? subcategory
        : subs[0].id;
  const addSub = filterSub ?? undefined;

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      map.set(entry.category, (map.get(entry.category) ?? 0) + 1);
    }
    return map;
  }, [entries]);

  const categoryEntries = useMemo(() => {
    if (!current) return [];
    return entries.filter((entry) => entry.category === current.id);
  }, [entries, current]);

  const subCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of categoryEntries) {
      const id = entry.subcategory ?? "";
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [categoryEntries]);

  const pageEntries = useMemo(() => {
    const filtered = filterSub
      ? categoryEntries.filter((entry) => entry.subcategory === filterSub)
      : categoryEntries;
    return filtered.slice().sort((left, right) => compareEntries(left, right, sortKey, sortDir));
  }, [categoryEntries, filterSub, sortKey, sortDir]);

  const showRatingSort = !current || usesRating(current.id);
  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "title", label: "Название" },
    { key: "released", label: "Дата" },
    ...(showRatingSort ? [{ key: "rating" as const, label: "Оценка" }] : []),
  ];

  useEffect(() => {
    if (!showRatingSort && sortKey === "rating") {
      setSortKey("title");
      setSortDir("asc");
    }
  }, [showRatingSort, sortKey]);

  function chooseSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((currentDir) => (currentDir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(defaultSortDir(key));
  }

  const homeNeedle = homeQuery.trim().toLocaleLowerCase("ru");
  const homeResults = useMemo(() => {
    if (!homeNeedle) return [];
    return entries
      .filter((entry) => {
        const shown = displayTitle(entry.title).toLocaleLowerCase("ru");
        const stored = entry.title.toLocaleLowerCase("ru");
        const alt = (entry.fields.altTitle ?? "").toLocaleLowerCase("ru");
        return shown.includes(homeNeedle) || stored.includes(homeNeedle) || alt.includes(homeNeedle);
      })
      .sort(byTitle);
  }, [entries, homeNeedle]);

  const selected = entries.find((entry) => entry.relativePath === selectedPath) ?? null;

  async function refreshArchive() {
    setRefreshing(true);
    setError("");
    try {
      await reload();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setRefreshing(false);
    }
  }

  function openCard(relativePath: string) {
    setEditing(false);
    setSelectedPath(relativePath);
  }

  function openMenu(event: React.MouseEvent, relativePath: string) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ path: relativePath, x: event.clientX, y: event.clientY });
  }

  const menuEntry = entries.find((entry) => entry.relativePath === menu?.path) ?? null;
  const moving = entries.find((entry) => entry.relativePath === movingPath) ?? null;
  const deleting = entries.find((entry) => entry.relativePath === deletingPath) ?? null;

  function openHome() {
    setCategoryId(null);
    setEditing(false);
    setSelectedPath(null);
  }

  function openCategory(id: string) {
    setCategoryId(id);
    setSubcategory(categoryById(id)?.subcategories?.[0]?.id ?? "");
    if (usesRating(id)) {
      setSortKey("rating");
      setSortDir("desc");
    } else {
      setSortKey("title");
      setSortDir("asc");
    }
    setEditing(false);
    setSelectedPath(null);
  }

  async function afterChange(nextPath?: string) {
    try {
      await reload(nextPath);
      setError("");
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  function posterCard(entry: Entry, options?: { place?: string; menu?: boolean }) {
    const alt = entry.fields.altTitle?.trim() ?? "";
    const released = entry.fields.released?.trim() ?? "";
    const year = releaseYear(released);
    const rated = usesRating(entry.category);
    return (
      <button
        type="button"
        className={entry.relativePath === selectedPath ? "poster on" : "poster"}
        onClick={() => openCard(entry.relativePath)}
        onContextMenu={
          options?.menu ? (event) => openMenu(event, entry.relativePath) : undefined
        }
      >
        <span className="poster-frame">
          <Cover lazy imagePath={entry.imagePath} title={displayTitle(entry.title)} />
          <span className="poster-shade" aria-hidden="true" />
          {(rated || year) && (
            <span className="poster-overlay">
              {rated && entry.rating > 0 && (
                <span className="poster-stars" aria-label={`${entry.rating} из 5`}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <svg
                      key={star}
                      className={star <= entry.rating ? "on" : undefined}
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M8 1.2 9.85 5.55l4.7.4-3.58 3.1 1.1 4.6L8 11.25 3.93 13.65l1.1-4.6L1.45 5.95l4.7-.4L8 1.2Z"
                      />
                    </svg>
                  ))}
                </span>
              )}
              {year && <span className="poster-year-chip">{year}</span>}
            </span>
          )}
        </span>
        <span className="poster-meta">
          <span className="poster-title">{displayTitle(entry.title)}</span>
          {alt ? <span className="poster-alt">{alt}</span> : null}
          {options?.place ? <span className="poster-place">{options.place}</span> : null}
          {released && (!year || released !== String(year)) ? (
            <span className="poster-released">{released}</span>
          ) : null}
        </span>
      </button>
    );
  }

  return (
    <div className="app">
      <aside className="rail">
        <nav className="rail-nav" role="tablist" aria-label="Категории">
          <button
            type="button"
            role="tab"
            id="tab-home"
            className={current ? "rail-item" : "rail-item on"}
            aria-selected={!current}
            aria-controls="category-page"
            title="Главная"
            aria-label="Главная"
            onClick={openHome}
          >
            <HomeIcon />
          </button>
          {categories
            .filter((item) => !bottomMenu.has(item.id))
            .map((item) => {
              const count = counts.get(item.id) ?? 0;
              const selectedTab = item.id === current?.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`tab-${item.id}`}
                  className={selectedTab ? "rail-item on" : "rail-item"}
                  aria-selected={selectedTab}
                  aria-controls="category-page"
                  title={item.title}
                  aria-label={`${item.title}, ${count}`}
                  onClick={() => openCategory(item.id)}
                >
                  <CategoryIcon id={item.id} />
                </button>
              );
            })}
          <div className="rail-tail">
            {categories
              .filter((item) => bottomMenu.has(item.id))
              .map((item) => {
                const count = counts.get(item.id) ?? 0;
                const selectedTab = item.id === current?.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`tab-${item.id}`}
                    className={selectedTab ? "rail-item on" : "rail-item"}
                    aria-selected={selectedTab}
                    aria-controls="category-page"
                    title={item.title}
                    aria-label={`${item.title}, ${count}`}
                    onClick={() => openCategory(item.id)}
                  >
                    <CategoryIcon id={item.id} />
                  </button>
                );
              })}
          </div>
        </nav>
      </aside>

      <div className="main">
        {current && (
          <header className="topbar">
            <div className="title-row">
              <h1>{current.title}</h1>
              <p className="brand">
                {`${pageEntries.length} ${recordsLabel(pageEntries.length)}`}
              </p>
            </div>
            <div className="catalog-tools">
              {subs.length > 0 && (
                <div className="place-subs catalog-subs" role="tablist" aria-label="Подкатегория">
                  {subs.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      className={filterSub === item.id ? "place-sub on" : "place-sub"}
                      aria-selected={filterSub === item.id}
                      onClick={() => setSubcategory(item.id)}
                    >
                      {item.title}
                      <span className="catalog-sub-qty">{subCounts.get(item.id) ?? 0}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="catalog-sort" role="group" aria-label="Сортировка">
                {sortOptions.map((item) => {
                  const on = sortKey === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={on ? "catalog-sort-btn on" : "catalog-sort-btn"}
                      aria-pressed={on}
                      onClick={() => chooseSort(item.key)}
                    >
                      {item.label}
                      {on && <span className="catalog-sort-dir">{sortDir === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </header>
        )}

        {!current ? (
          <section
            id="category-page"
            className="page home-page"
            role="tabpanel"
            aria-labelledby="tab-home"
          >
            {error && <p className="error banner">{error}</p>}
            {loading ? (
              <p className="empty-state">Открываю полку…</p>
            ) : homeNeedle ? (
              homeResults.length > 0 ? (
                <ul className="grid home-results">
                  {homeResults.map((entry) => {
                    const shelf = categoryById(entry.category);
                    const sub = shelf?.subcategories?.find((item) => item.id === entry.subcategory);
                    const place = [shelf?.title, sub?.title].filter(Boolean).join(" · ");
                    return (
                      <li key={entry.relativePath}>{posterCard(entry, { place })}</li>
                    );
                  })}
                </ul>
              ) : null
            ) : (
              <HomeDrift
                entries={entries}
                paused={Boolean(selectedPath) || adding}
                onOpen={openCard}
              />
            )}
            <div className={homeNeedle ? "home-finder querying" : "home-finder"}>
              {!homeNeedle && (
                <h1 className="home-brand">
                  <span className="home-brand-freedom">Freedom</span>
                  <span className="home-brand-archive">Archive</span>
                </h1>
              )}
              <label className="home-search">
                <input
                  value={homeQuery}
                  onChange={(event) => setHomeQuery(event.target.value)}
                  aria-label="Поиск"
                />
                <svg className="home-loupe" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="10.2" cy="10.2" r="5.7" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M14.5 14.5 19.2 19.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </label>
              {homeNeedle && homeResults.length === 0 && !loading && (
                <p className="home-miss">Ничего не найдено</p>
              )}
            </div>
          </section>
        ) : (
          <section
            key={current.id}
            id="category-page"
            className="page catalog"
            role="tabpanel"
            aria-labelledby={`tab-${current.id}`}
          >
            <div className="catalog-main">
              {error && <p className="error banner">{error}</p>}

              {loading ? (
                <p className="empty-state">Открываю полку…</p>
              ) : pageEntries.length > 0 ? (
                <ul className="grid">
                  {pageEntries.map((entry) => (
                    <li key={entry.relativePath}>{posterCard(entry, { menu: true })}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        )}

        {menu && menuEntry && (
          <CatalogMenu
            x={menu.x}
            y={menu.y}
            title={displayTitle(menuEntry.title)}
            imagePath={menuEntry.imagePath}
            onClose={() => setMenu(null)}
            onEdit={() => {
              setMenu(null);
              setSelectedPath(menuEntry.relativePath);
              setEditing(true);
            }}
            onMove={() => {
              setMovingPath(menuEntry.relativePath);
              setMenu(null);
            }}
            onDelete={() => {
              setDeletingPath(menuEntry.relativePath);
              setMenu(null);
            }}
          />
        )}
        {moving && (
          <MoveDialog
            entry={moving}
            onClose={() => setMovingPath(null)}
            onMoved={async (entry) => {
              await afterChange(entry.relativePath);
              setMovingPath(null);
              setEditing(false);
              setSelectedPath(null);
            }}
          />
        )}
        {deleting && (
          <DeleteDialog
            entry={deleting}
            onClose={() => setDeletingPath(null)}
            onDeleted={async () => {
              await afterChange();
              setDeletingPath(null);
              setEditing(false);
              setSelectedPath(null);
            }}
          />
        )}
        {adding && (
          <AddDialog
            key={current ? `${current.id}:${addSub ?? "none"}` : "home"}
            initialCategory={current?.id ?? categories[0].id}
            initialSubcategory={current ? addSub : undefined}
            onClose={() => setAdding(false)}
            onAdded={async (entry) => {
              setCategoryId(entry.category);
              setSubcategory(entry.subcategory ?? "");
              await afterChange(entry.relativePath);
              setAdding(false);
              setEditing(false);
              setSelectedPath(null);
            }}
          />
        )}
        {selected && !editing && (
          <CoverZoom entry={selected} onClose={() => setSelectedPath(null)} />
        )}
        {selected && editing && (
          <CardDialog
            entry={selected}
            entries={entries}
            onClose={() => {
              setEditing(false);
              setSelectedPath(null);
            }}
            onSaved={async (relativePath) => {
              await afterChange(relativePath);
              setEditing(false);
              setSelectedPath(null);
            }}
            onDeleted={async () => {
              await afterChange();
              setEditing(false);
              setSelectedPath(null);
            }}
          />
        )}
      </div>
      <div className="corner-actions">
        <button type="button" className="add-fab" aria-label="Добавить" onClick={() => setAdding(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M11 4.5h2v6.5h6.5v2H13v6.5h-2V13H4.5v-2H11V4.5Z" />
          </svg>
        </button>
        {!current && (
          <button
            type="button"
            className={refreshing ? "refresh-fab busy" : "refresh-fab"}
            onClick={() => void refreshArchive()}
            disabled={refreshing || loading}
            aria-label="Обновить"
            title="Обновить"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
