import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { deleteEntry, errorText, moveEntry } from "../api";
import { Stars } from "./Stars";
import { categories, categoryById, placement, usesRating } from "../schema/categories";
import { displayTitle, fileStem, releaseYear } from "../title";
import type { Entry } from "../types";

type CatalogMenuProps = {
  x: number;
  y: number;
  title: string;
  imagePath: string;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
  onClose: () => void;
};

async function copyTitle(title: string) {
  await navigator.clipboard.writeText(title);
}

function blobToPng(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error("не удалось подготовить изображение"));
        return;
      }
      context.drawImage(image, 0, 0);
      canvas.toBlob((next) => {
        URL.revokeObjectURL(url);
        if (next) resolve(next);
        else reject(new Error("не удалось подготовить изображение"));
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("не удалось прочитать изображение"));
    };
    image.src = url;
  });
}

async function copyImage(imagePath: string) {
  if (typeof ClipboardItem === "undefined") {
    throw new Error("копирование изображений недоступно");
  }
  const response = await fetch(convertFileSrc(imagePath));
  if (!response.ok) throw new Error("не удалось прочитать изображение");
  const blob = await response.blob();
  const png = blob.type === "image/png" ? blob : await blobToPng(blob);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

export function CatalogMenu({
  x,
  y,
  title,
  imagePath,
  onEdit,
  onMove,
  onDelete,
  onClose,
}: CatalogMenuProps) {
  const [point, setPoint] = useState({ x, y });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function place(node: HTMLDivElement | null) {
      if (!node) return;
      const box = node.getBoundingClientRect();
      const nextX = Math.max(8, Math.min(x, window.innerWidth - box.width - 8));
      const nextY = Math.max(8, Math.min(y, window.innerHeight - box.height - 8));
      setPoint({ x: nextX, y: nextY });
    }
    const node = document.getElementById("catalog-menu");
    place(node as HTMLDivElement | null);
  }, [x, y]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && document.getElementById("catalog-menu")?.contains(target)) return;
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  async function runCopy(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div
      id="catalog-menu"
      className="context-menu"
      role="menu"
      aria-label={title}
      style={{ left: point.x, top: point.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={onEdit}>
        Редактировать
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        onClick={() => void runCopy(() => copyTitle(title))}
      >
        Копировать название
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        onClick={() => void runCopy(() => copyImage(imagePath))}
      >
        Копировать изображение
      </button>
      <button type="button" role="menuitem" onClick={onMove}>
        Переместить
      </button>
      <button type="button" role="menuitem" className="danger-item" onClick={onDelete}>
        Удалить
      </button>
    </div>
  );
}

type MoveDialogProps = {
  entry: Entry;
  onClose: () => void;
  onMoved: (entry: Entry) => Promise<void>;
};

export function MoveDialog({ entry, onClose, onMoved }: MoveDialogProps) {
  const [category, setCategory] = useState(entry.category);
  const [subcategory, setSubcategory] = useState(entry.subcategory ?? "");
  const [rating, setRating] = useState(entry.rating);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const current = categoryById(category);
  const subs = current?.subcategories ?? [];
  const rated = usesRating(category);
  const nextSub = subs.length ? subcategory || subs[0]?.id || null : null;
  const nextRating = rated ? rating : 0;
  const same =
    category === entry.category &&
    nextSub === (entry.subcategory ?? null) &&
    nextRating === entry.rating;
  const folder = useMemo(
    () => placement(category, nextSub, nextRating),
    [category, nextSub, nextRating],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  function chooseCategory(id: string) {
    setCategory(id);
    const next = categoryById(id);
    setSubcategory(next?.subcategories?.[0]?.id ?? "");
    if (!usesRating(id)) setRating(0);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (same) return;
    const year = releaseYear(entry.fields.released ?? "");
    if (!year) {
      setError("у записи нет года в дате выхода");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const moved = await moveEntry({
        relativePath: entry.relativePath,
        category,
        subcategory: nextSub,
        rating: nextRating,
        title: entry.title,
        year,
      });
      await onMoved(moved);
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <form
        className="dialog move-dialog"
        role="dialog"
        aria-labelledby="move-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="dialog-head">
          <h2 id="move-title">Переместить</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <p className="move-name">{displayTitle(entry.title)}</p>
        <label>
          <span className="editor-label">Категория</span>
          <select value={category} onChange={(event) => chooseCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        {subs.length > 0 && (
          <label>
            <span className="editor-label">Подкатегория</span>
            <select value={subcategory} onChange={(event) => setSubcategory(event.target.value)}>
              {subs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {rated && (
          <div>
            <p className="editor-label">Оценка</p>
            <Stars value={rating} onChange={setRating} />
          </div>
        )}
        <p className="editor-path">
          {folder}/
          {releaseYear(entry.fields.released ?? "")
            ? fileStem(entry.title, releaseYear(entry.fields.released ?? "")!)
            : entry.title}
        </p>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="primary" disabled={busy || same}>
            {busy ? "Перемещаю…" : "Переместить"}
          </button>
        </div>
      </form>
    </div>
  );
}

type DeleteDialogProps = {
  entry: Entry;
  onClose: () => void;
  onDeleted: () => Promise<void>;
};

export function DeleteDialog({ entry, onClose, onDeleted }: DeleteDialogProps) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await deleteEntry(entry.relativePath);
      await onDeleted();
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div
        className="dialog move-dialog"
        role="dialog"
        aria-labelledby="delete-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="delete-title">Удалить запись?</h2>
        <p className="move-name">{displayTitle(entry.title)}</p>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="danger" disabled={busy} onClick={remove}>
            {busy ? "Удаляю…" : "Удалить"}
          </button>
        </div>
      </div>
    </div>
  );
}
