import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { addEntry, errorText } from "../api";
import { Stars } from "./Stars";
import { categories, categoryById, placement, usesRating } from "../schema/categories";
import type { Entry } from "../types";

type AddDialogProps = {
  initialCategory?: string;
  initialSubcategory?: string;
  onClose: () => void;
  onAdded: (entry: Entry) => Promise<void>;
};

function fileStem(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? "";
  return name.replace(/\.[^.]+$/, "");
}

function filePreview(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return "";
  }
}

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|bmp|jfif)$/i;

function firstImage(paths: string[]): string | undefined {
  return paths.find((path) => IMAGE_FILE.test(path));
}

function PhotoPreview({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (!src || failed) return <span className="add-empty">Фото</span>;
  return <img src={src} alt="" onError={() => setFailed(true)} />;
}

export function AddDialog({
  initialCategory,
  initialSubcategory,
  onClose,
  onAdded,
}: AddDialogProps) {
  const start = categoryById(initialCategory ?? "") ?? categories[0];
  const [sourcePath, setSourcePath] = useState("");
  const [link, setLink] = useState("");
  const [mode, setMode] = useState<"file" | "link">("file");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(start.id);
  const [subcategory, setSubcategory] = useState(
    initialSubcategory && start.subcategories?.some((item) => item.id === initialSubcategory)
      ? initialSubcategory
      : (start.subcategories?.[0].id ?? ""),
  );
  const [rating, setRating] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const current = categoryById(category);
  const subs = current?.subcategories ?? [];
  const rated = usesRating(category);
  const folder = useMemo(
    () => placement(category, subs.length ? subcategory || null : null, rated ? rating : 0),
    [category, subcategory, subs.length, rating, rated],
  );
  const linkValue = link.trim();
  const usingLink = mode === "link" && linkValue.length > 0;
  const preview = usingLink ? linkValue : sourcePath ? filePreview(sourcePath) : "";
  const ready = title.trim().length > 0 && (usingLink || sourcePath.length > 0);

  function chooseCategory(id: string) {
    setCategory(id);
    const next = categoryById(id);
    setSubcategory(next?.subcategories?.[0].id ?? "");
  }

  function takeFile(path: string) {
    setError("");
    setMode("file");
    setSourcePath(path);
    setTitle((currentTitle) => currentTitle || fileStem(path));
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "leave") {
            setDragging(false);
            return;
          }
          if (payload.type === "enter" || payload.type === "over") {
            setDragging(true);
            return;
          }
          setDragging(false);
          const image = firstImage(payload.paths);
          if (!image) {
            setError("нужен файл изображения");
            return;
          }
          takeFile(image);
        })
        .then((stop) => {
          if (active) unlisten = stop;
          else stop();
        })
        .catch(() => {});
    } catch {
      // В браузере без окна приложения перетаскивание с диска недоступно.
    }
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  function dropFile(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0] as (File & { path?: string }) | undefined;
    if (file?.path) takeFile(file.path);
  }

  async function chooseFile() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Изображения",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "jfif"],
        },
      ],
    });
    if (typeof selected !== "string") return;
    takeFile(selected);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const entry = await addEntry({
        sourcePath: usingLink ? undefined : sourcePath,
        sourceUrl: usingLink ? linkValue : undefined,
        category,
        subcategory: subs.length ? subcategory || null : null,
        rating: rated ? rating : 0,
        title,
      });
      await onAdded(entry);
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <form
        className="dialog add-dialog"
        role="dialog"
        aria-labelledby="add-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header className="add-head">
          <div>
            <p className="add-kicker">Freedom Archive</p>
            <h2 id="add-title">Новая запись</h2>
          </div>
          <button type="button" className="card-icon" aria-label="Закрыть" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z"
              />
            </svg>
          </button>
        </header>

        <div className="add-layout">
          <div className="add-photo">
            <button
              type="button"
              className={dragging ? "add-frame over" : "add-frame"}
              onClick={chooseFile}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragging(false);
              }}
              onDrop={dropFile}
            >
              <PhotoPreview src={preview} />
              <span className="add-frame-caption">
                {dragging ? "Отпустите файл" : sourcePath && !usingLink ? "Сменить фото" : "Выбрать или перетащить фото"}
              </span>
            </button>
          </div>

          <div className="add-fields">
            <label>
              <span className="editor-label">Название</span>
              <input
                className="add-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Как будет называться файл"
                required
                autoFocus
              />
              <span className="hint">Файл переименуется в это название</span>
            </label>

            <div className="add-block">
              <p className="editor-label">Категория</p>
              <div className="filter-options" role="group" aria-label="Категория">
                {categories.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={category === item.id ? "filter-option on" : "filter-option"}
                    onClick={() => chooseCategory(item.id)}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            </div>

            {subs.length > 0 && (
              <div className="add-block">
                <p className="editor-label">Подкатегория</p>
                <div className="filter-options" role="group" aria-label="Подкатегория">
                  {subs.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={subcategory === item.id ? "filter-option on" : "filter-option"}
                      onClick={() => setSubcategory(item.id)}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {rated && (
              <div className="add-block">
                <p className="editor-label">Оценка</p>
                <div className="add-score">
                  <Stars value={rating} onChange={setRating} />
                </div>
              </div>
            )}

            <div className="add-block">
              <p className="editor-label">Источник</p>
              <div className="add-modes" role="group" aria-label="Источник">
                <button
                  type="button"
                  className={mode === "file" ? "filter-option on" : "filter-option"}
                  onClick={() => setMode("file")}
                >
                  С диска
                </button>
                <button
                  type="button"
                  className={mode === "link" ? "filter-option on" : "filter-option"}
                  onClick={() => setMode("link")}
                >
                  По ссылке
                </button>
              </div>
              {mode === "link" ? (
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={link}
                  onChange={(event) => {
                    setLink(event.target.value);
                    setMode("link");
                  }}
                />
              ) : (
                <p className="hint">{sourcePath ? fileStem(sourcePath) : "Нажмите на обложку или перетащите файл"}</p>
              )}
            </div>

            <p className="editor-path">
              {folder}/{title.trim() || "…"}
            </p>
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        <footer className="dialog-actions">
          <button type="submit" className="primary" disabled={busy || !ready}>
            {busy ? (usingLink ? "Скачиваю…" : "Сохраняю…") : "Добавить"}
          </button>
        </footer>
      </form>
    </div>
  );
}
