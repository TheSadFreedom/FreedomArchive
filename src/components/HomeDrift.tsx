import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { Entry } from "../types";
import { displayTitle } from "../title";

type Drifter = {
  entry: Entry;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  spin: number;
};

type HomeDriftProps = {
  entries: Entry[];
  paused: boolean;
  onOpen: (relativePath: string) => void;
};

const FALLING = 12;

function sample(entries: Entry[], count: number): Entry[] {
  const copy = [...entries];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap];
    copy[swap] = current;
  }
  return copy.slice(0, Math.min(count, copy.length));
}

function another(entries: Entry[], avoid: string): Entry | undefined {
  if (entries.length === 0) return undefined;
  const pick = entries[Math.floor(Math.random() * entries.length)];
  if (pick.relativePath !== avoid || entries.length === 1) return pick;
  return entries[Math.floor(Math.random() * entries.length)];
}

function makeFaller(entry: Entry, width: number): Drifter {
  const w = 72 + Math.random() * Math.min(150, Math.max(90, width * 0.2));
  const h = w * 1.42;
  return {
    entry,
    w,
    h,
    x: Math.random() * Math.max(1, width - w),
    y: -h,
    vx: (Math.random() - 0.5) * 24,
    vy: 80 + Math.random() * 170,
    rot: (Math.random() - 0.5) * 18,
    spin: (Math.random() - 0.5) * 10,
  };
}

export function HomeDrift({ entries, paused, onOpen }: HomeDriftProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);
  const items = useRef<Drifter[]>([]);
  const pausedRef = useRef(paused);
  const [posters, setPosters] = useState<Entry[]>([]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    setPosters((current) => {
      const byPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
      const kept = current
        .map((entry) => byPath.get(entry.relativePath))
        .filter((entry): entry is Entry => Boolean(entry));
      const target = Math.min(FALLING, entries.length);
      if (
        kept.length === target &&
        kept.length === current.length &&
        kept.every((entry, index) => entry.relativePath === current[index]?.relativePath)
      ) {
        return current;
      }
      const used = new Set(kept.map((entry) => entry.relativePath));
      const extra = sample(
        entries.filter((entry) => !used.has(entry.relativePath)),
        target - kept.length,
      );
      return [...kept, ...extra];
    });
  }, [entries]);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || posters.length === 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let alive = true;
    let frame = 0;
    let last = performance.now();

    const paintItem = (item: Drifter, index: number) => {
      const node = nodes.current[index];
      if (!node) return;
      node.style.width = `${item.w}px`;
      node.style.height = `${item.h}px`;
      node.style.transform = `translate3d(${item.x}px, ${item.y}px, 0) rotate(${item.rot}deg)`;
      if (node.dataset.cover !== item.entry.relativePath) {
        node.dataset.cover = item.entry.relativePath;
        node.setAttribute("aria-label", displayTitle(item.entry.title));
        const image = node.querySelector("img");
        if (image) image.src = convertFileSrc(item.entry.imagePath);
      }
    };

    const paint = () => {
      items.current.forEach(paintItem);
    };

    const dropAgain = (item: Drifter, index: number, width: number) => {
      const next = another(entriesRef.current, item.entry.relativePath) ?? item.entry;
      const fresh = makeFaller(next, width);
      fresh.y = -fresh.h - Math.random() * 120;
      Object.assign(item, fresh);
      paintItem(item, index);
    };

    const spawn = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (width < 80 || height < 80) return false;
      items.current = posters.map((entry, index) => {
        const item = makeFaller(entry, width);
        item.y = -item.h + ((index + Math.random() * 0.6) / posters.length) * (height + item.h);
        return item;
      });
      paint();
      return true;
    };

    const tick = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.034, (now - last) / 1000);
      last = now;
      if (!reduced && !pausedRef.current && !document.hidden && items.current.length > 0) {
        const width = stage.clientWidth;
        const height = stage.clientHeight;
        items.current.forEach((item, index) => {
          item.x += item.vx * dt;
          item.y += item.vy * dt;
          item.rot += item.spin * dt;
          if (item.x <= 0) {
            item.x = 0;
            item.vx = Math.abs(item.vx);
          } else if (item.x + item.w >= width) {
            item.x = Math.max(0, width - item.w);
            item.vx = -Math.abs(item.vx);
          }
          if (item.rot > 16) item.spin = -Math.abs(item.spin);
          else if (item.rot < -16) item.spin = Math.abs(item.spin);
          if (item.y > height) dropAgain(item, index, width);
          else paintItem(item, index);
        });
      }
      frame = requestAnimationFrame(tick);
    };

    const observer = new ResizeObserver(() => {
      if (items.current.length === 0) {
        spawn();
        return;
      }
      const width = stage.clientWidth;
      for (const item of items.current) {
        item.x = Math.min(Math.max(0, item.x), Math.max(0, width - item.w));
      }
      paint();
    });

    observer.observe(stage);
    spawn();
    frame = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      items.current = [];
    };
  }, [posters]);

  if (posters.length === 0) return null;

  return (
    <div className="float-stage" ref={stageRef} aria-label="Обложки">
      {posters.map((entry, index) => (
        <button
          key={entry.relativePath}
          type="button"
          className="floater"
          aria-label={displayTitle(entry.title)}
          ref={(node) => {
            nodes.current[index] = node;
          }}
          onClick={() => onOpen(items.current[index]?.entry.relativePath ?? entry.relativePath)}
        >
          <img src={convertFileSrc(entry.imagePath)} alt="" draggable={false} />
        </button>
      ))}
    </div>
  );
}
