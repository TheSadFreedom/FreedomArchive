import { useCallback, useEffect, useMemo, useState } from "react";
import { errorText, listEntries } from "./api";
import { AddDialog } from "./components/AddDialog";
import { CardDialog } from "./components/CardDialog";
import { CardView } from "./components/CardView";
import { CategoryIcon, HomeIcon } from "./components/CategoryIcon";
import { Cover } from "./components/Cover";
import { HomeDrift } from "./components/HomeDrift";
import { Stars } from "./components/Stars";
import {
  categories,
  categoryById,
  fieldsFor,
  ratingLabel,
  usesRating,
} from "./schema/categories";
import { collectFacets, matchesFacets, tagKey } from "./schema/tags";
import { compareEntries, defaultSortDir, type SortDir, type SortKey } from "./schema/sort";
import type { Entry } from "./types";
import { displayTitle } from "./title";
import "./App.css";

function recordsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "запись";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "записи";
  return "записей";
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
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategory, setSubcategory] = useState("");
  const [rating, setRating] = useState("");
  const [selectedFacets, setSelectedFacets] = useState<Record<string, string[]>>({});
  const [filterQuery, setFilterQuery] = useState("");
  const [facetOpen, setFacetOpen] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<SortKey>("rating");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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
      if (event.key === "Escape") {
        setAdding(false);
        if (editing) setEditing(false);
        else setSelectedPath(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const current = categoryId ? categoryById(categoryId) : undefined;
  const subs = current?.subcategories ?? [];
  const activeSub =
    subs.length === 0
      ? ""
      : subs.some((item) => item.id === subcategory)
        ? subcategory
        : subs[0].id;
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      map.set(entry.category, (map.get(entry.category) ?? 0) + 1);
    }
    return map;
  }, [entries]);

  const pageEntries = useMemo(
    () => (current ? entries.filter((entry) => entry.category === current.id) : []),
    [entries, current],
  );

  const shelfEntries = useMemo(
    () =>
      pageEntries.filter((entry) =>
        activeSub ? entry.subcategory === activeSub : !entry.subcategory,
      ),
    [pageEntries, activeSub],
  );

  const facets = useMemo(
    () => collectFacets(fieldsFor(current?.id, activeSub), shelfEntries),
    [current, activeSub, shelfEntries],
  );

  useEffect(() => {
    const known = new Map(facets.map((facet) => [facet.key, new Set(facet.values.map(tagKey))]));
    setSelectedFacets((currentFacets) => {
      let changed = false;
      const next: Record<string, string[]> = {};
      for (const [key, picked] of Object.entries(currentFacets)) {
        const allowed = known.get(key);
        if (!allowed) {
          changed = true;
          continue;
        }
        const kept = picked.filter((item) => allowed.has(item));
        if (kept.length !== picked.length) changed = true;
        if (kept.length > 0) next[key] = kept;
      }
      return changed ? next : currentFacets;
    });
  }, [facets]);

  const showRating = !current || usesRating(current.id);
  const visible = useMemo(() => {
    const filtered = shelfEntries.filter((entry) => {
      if (showRating && rating !== "" && entry.rating !== Number(rating)) return false;
      return matchesFacets(entry.fields, selectedFacets);
    });
    return filtered.sort((left, right) => compareEntries(left, right, sortKey, sortDir));
  }, [shelfEntries, rating, selectedFacets, showRating, sortKey, sortDir]);

  const query = filterQuery.trim().toLocaleLowerCase("ru");
  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "title", label: "Название" },
    ...(showRating ? [{ key: "rating" as const, label: "Оценка" }] : []),
    { key: "released", label: "Дата выхода" },
  ];
  const shownSorts = query
    ? sortOptions.filter((item) => item.label.toLocaleLowerCase("ru").includes(query))
    : sortOptions;
  const shownSubs = query
    ? subs.filter((item) => item.title.toLocaleLowerCase("ru").includes(query))
    : subs;
  const shownFacets = useMemo(() => {
    if (!query) return facets;
    return facets
      .map((facet) => {
        const labelHit = facet.label.toLocaleLowerCase("ru").includes(query);
        return {
          ...facet,
          values: labelHit
            ? facet.values
            : facet.values.filter((value) => value.toLocaleLowerCase("ru").includes(query)),
        };
      })
      .filter((facet) => facet.values.length > 0);
  }, [facets, query]);
  const filtersOn = (showRating && rating !== "") || Object.keys(selectedFacets).length > 0;
  const activeTokens = facets.flatMap((facet) =>
    (selectedFacets[facet.key] ?? []).map((key) => ({
      field: facet.key,
      key,
      label: facet.values.find((value) => tagKey(value) === key) ?? key,
    })),
  );

  useEffect(() => {
    if (!showRating && sortKey === "rating") {
      setSortKey("title");
      setSortDir("asc");
    }
  }, [showRating, sortKey]);

  function clearFilters() {
    setRating("");
    setSelectedFacets({});
  }

  function chooseSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(defaultSortDir(key));
  }

  function toggleFacetValue(field: string, key: string) {
    setSelectedFacets((currentFacets) => {
      const currentPicked = currentFacets[field] ?? [];
      const nextPicked = currentPicked.includes(key)
        ? currentPicked.filter((item) => item !== key)
        : [...currentPicked, key];
      const next = { ...currentFacets };
      if (nextPicked.length === 0) delete next[field];
      else next[field] = nextPicked;
      return next;
    });
  }

  function clearFacet(field: string) {
    setSelectedFacets((currentFacets) => {
      if (!currentFacets[field]) return currentFacets;
      const next = { ...currentFacets };
      delete next[field];
      return next;
    });
  }

  function facetIsOpen(key: string, picked: number) {
    if (query) return true;
    if (key in facetOpen) return facetOpen[key];
    return picked > 0 || key === "genre" || key === "themes" || key === "theme" || key === "released";
  }

  const homeNeedle = homeQuery.trim().toLocaleLowerCase("ru");
  const homeResults = useMemo(() => {
    if (!homeNeedle) return [];
    return entries
      .filter((entry) => {
        const shown = displayTitle(entry.title).toLocaleLowerCase("ru");
        const stored = entry.title.toLocaleLowerCase("ru");
        const alt = (entry.fields.altTitle ?? "").toLocaleLowerCase("ru");
        const franchise = (entry.fields.franchise ?? "").toLocaleLowerCase("ru");
        return (
          shown.includes(homeNeedle) ||
          stored.includes(homeNeedle) ||
          alt.includes(homeNeedle) ||
          franchise.includes(homeNeedle)
        );
      })
      .sort((left, right) => displayTitle(left.title).localeCompare(displayTitle(right.title), "ru"));
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

  function openHome() {
    setCategoryId(null);
    setEditing(false);
    setSelectedPath(null);
  }

  function openCategory(id: string) {
    const next = categoryById(id);
    setCategoryId(id);
    setSubcategory(next?.subcategories?.[0]?.id ?? "");
    setRating("");
    setSelectedFacets({});
    setFilterQuery("");
    setFacetOpen({});
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
          {categories.map((item) => {
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
                  <li key={entry.relativePath}>
                    <button
                      type="button"
                      className={entry.relativePath === selectedPath ? "poster on" : "poster"}
                      onClick={() => openCard(entry.relativePath)}
                    >
                      <span className="poster-frame">
                        <Cover lazy imagePath={entry.imagePath} title={displayTitle(entry.title)} />
                        {usesRating(entry.category) && (
                          <span className="poster-score">
                            <Stars value={entry.rating} />
                          </span>
                        )}
                      </span>
                      <span className="poster-title">{displayTitle(entry.title)}</span>
                      {entry.fields.altTitle?.trim() && (
                        <span className="poster-alt">{entry.fields.altTitle.trim()}</span>
                      )}
                      {place && <span className="poster-place">{place}</span>}
                    </button>
                  </li>
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
          ) : visible.length > 0 ? (
            <ul className="grid">
              {visible.map((entry) => (
                <li key={entry.relativePath}>
                  <button
                    type="button"
                    className={entry.relativePath === selectedPath ? "poster on" : "poster"}
                    onClick={() => openCard(entry.relativePath)}
                  >
                    <span className="poster-frame">
                      <Cover lazy imagePath={entry.imagePath} title={displayTitle(entry.title)} />
                      {usesRating(entry.category) && (
                        <span className="poster-score">
                          <Stars value={entry.rating} />
                        </span>
                      )}
                    </span>
                    <span className="poster-title">{displayTitle(entry.title)}</span>
                    {entry.fields.altTitle?.trim() && (
                      <span className="poster-alt">{entry.fields.altTitle.trim()}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <aside className="filters" aria-label="Фильтры">
          <div className="filters-head">
            <h2>Фильтры</h2>
            {filtersOn && (
              <button type="button" className="filters-reset" onClick={clearFilters}>
                Сбросить
              </button>
            )}
          </div>

          {((showRating && rating !== "") || activeTokens.length > 0) && (
            <div className="filter-active">
              {showRating && rating !== "" && (
                <button type="button" className="filter-token" onClick={() => setRating("")}>
                  {ratingLabel(Number(rating))}
                  <span aria-hidden="true">×</span>
                </button>
              )}
              {activeTokens.map((token) => (
                <button
                  key={`${token.field}:${token.key}`}
                  type="button"
                  className="filter-token"
                  onClick={() => toggleFacetValue(token.field, token.key)}
                >
                  {token.label}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          )}

          <input
            className="filter-search"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Найти"
            aria-label="Найти фильтр"
          />

          {shownSorts.length > 0 && (
            <div className="filter-block">
              <p className="filter-label">Сортировка</p>
              <div className="filter-options" role="group" aria-label="Сортировка">
                {shownSorts.map((item) => {
                  const on = sortKey === item.key;
                  const dirLabel = sortDir === "asc" ? "по возрастанию" : "по убыванию";
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={on ? "filter-option on" : "filter-option"}
                      aria-pressed={on}
                      aria-label={on ? `${item.label}, ${dirLabel}` : item.label}
                      onClick={() => chooseSort(item.key)}
                    >
                      {item.label}
                      {on && <span className="filter-dir">{sortDir === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {shownSubs.length > 0 && (
            <div className="filter-block">
              <p className="filter-label">Подкатегория</p>
              <div className="filter-options" role="group" aria-label="Подкатегория">
                {shownSubs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={activeSub === item.id ? "filter-option on" : "filter-option"}
                    onClick={() => setSubcategory(item.id)}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showRating && (
          <div className="filter-block">
            <p className="filter-label">Оценка</p>
            <div className="filter-options" role="group" aria-label="Оценка">
              <button
                type="button"
                className={rating === "" ? "filter-option on" : "filter-option"}
                onClick={() => setRating("")}
              >
                Все
              </button>
              <button
                type="button"
                className={rating === "0" ? "filter-option on" : "filter-option"}
                onClick={() => setRating(rating === "0" ? "" : "0")}
              >
                Без оценки
              </button>
            </div>
            <div className="filter-stars" role="group" aria-label="Оценка звёздами">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={rating !== "" && rating !== "0" && Number(rating) >= value ? "star on" : "star"}
                  aria-pressed={rating === String(value)}
                  aria-label={ratingLabel(value)}
                  onClick={() => setRating(rating === String(value) ? "" : String(value))}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M8 1.2 9.85 5.55l4.7.4-3.58 3.1 1.1 4.6L8 11.25 3.93 13.65l1.1-4.6L1.45 5.95l4.7-.4L8 1.2Z"
                    />
                  </svg>
                </button>
              ))}
            </div>
          </div>
          )}

          {shownFacets.map((facet) => {
            const picked = selectedFacets[facet.key] ?? [];
            const open = facetIsOpen(facet.key, picked.length);
            return (
              <div key={facet.key} className="filter-block">
                <button
                  type="button"
                  className="filter-fold"
                  aria-expanded={open}
                  onClick={() =>
                    setFacetOpen((currentOpen) => ({ ...currentOpen, [facet.key]: !open }))
                  }
                >
                  <span>{facet.label}</span>
                  <span className="filter-fold-meta">
                    {picked.length > 0 && <span className="filter-count">{picked.length}</span>}
                    <svg className={open ? "chev on" : "chev"} viewBox="0 0 16 16" aria-hidden="true">
                      <path fill="currentColor" d="M4.2 6.1 8 9.9l3.8-3.8 1.1 1.1L8 12.1 3.1 7.2l1.1-1.1Z" />
                    </svg>
                  </span>
                </button>
                {open && (
                  <div className="filter-values">
                    <div className="filter-options" role="group" aria-label={facet.label}>
                      {facet.values.map((value) => {
                        const key = tagKey(value);
                        const on = picked.includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            className={on ? "filter-option on" : "filter-option"}
                            aria-pressed={on}
                            onClick={() => toggleFacetValue(facet.key, key)}
                          >
                            {value}
                          </button>
                        );
                      })}
                    </div>
                    {picked.length > 0 && (
                      <button type="button" className="filter-clear" onClick={() => clearFacet(facet.key)}>
                        Сбросить
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {query && shownSorts.length === 0 && shownSubs.length === 0 && shownFacets.length === 0 && (
            <p className="filter-empty">Ничего не найдено</p>
          )}
        </aside>
      </section>
      )}

      {adding && (
        <AddDialog
          key={current ? `${current.id}:${activeSub}` : "home"}
          initialCategory={current?.id ?? categories[0].id}
          initialSubcategory={current ? activeSub : undefined}
          onClose={() => setAdding(false)}
          onAdded={async (entry) => {
            setCategoryId(entry.category);
            setSubcategory(entry.subcategory ?? "");
            setRating("");
            setSelectedFacets({});
            setFilterQuery("");
            setFacetOpen({});
            await afterChange(entry.relativePath);
            setAdding(false);
            setEditing(false);
          }}
        />
      )}
      {selected && !editing && (
        <CardView
          entry={selected}
          onClose={() => setSelectedPath(null)}
          onEdit={() => setEditing(true)}
        />
      )}
      {selected && editing && (
        <CardDialog
          entry={selected}
          entries={entries}
          onClose={() => setEditing(false)}
          onSaved={async (relativePath) => {
            await afterChange(relativePath);
            setEditing(false);
          }}
          onDeleted={async () => {
            await afterChange();
            setEditing(false);
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
