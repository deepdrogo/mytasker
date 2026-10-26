/**
 * Vertical drag-to-reorder without a library: pointer events (mouse, touch, pen) plus arrow keys on the handle.
 *
 * The list re-renders live while dragging: the grabbed row follows the pointer with a transform, the others are
 * moved in the DOM and slide into place with a short FLIP animation. Positions are measured with `offsetTop`, which
 * ignores in-flight transforms, so the midpoint test never fights the animation. On drop `onReorder` fires with the
 * new order only when something actually moved.
 *
 * Usage:
 *   const sortable = createSortable({ items: () => list(), key: (p) => p.id, onReorder: persist });
 *   <ul ref={sortable.setContainer}>
 *     <For each={sortable.items()}>{(item) => (
 *       <li {...sortable.itemProps(item)} style={sortable.itemStyle(item)}>
 *         <button {...sortable.handleProps(item)}>⋮⋮</button>
 *       </li>
 *     )}</For>
 *   </ul>
 */

import { createEffect, createSignal, on, onCleanup, type Accessor, type JSX } from 'solid-js';

export type SortableKey = string | number;

export interface SortableOptions<T> {
  items: Accessor<readonly T[]>;
  key: (item: T) => SortableKey;
  /** Called after a drop or arrow-key move that changed the order. */
  onReorder: (items: T[], keys: SortableKey[]) => void | Promise<void>;
  /** Set to false to render the list read-only (no handles react). */
  enabled?: Accessor<boolean>;
  /**
   * `grid` is a wrapping chip board: the pointer can move a chip sideways as well as up and down.
   * Omitted means a single vertical list, measured with `offsetTop` so in-flight animations are ignored.
   */
  flow?: Accessor<'vertical' | 'grid'>;
}

export interface GridBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a dragged chip should sit in a wrapping grid. `x`/`y` are its centre, in the same coordinates as
 * `boxes`. Boxes on an earlier row count first; on the same row, boxes whose centre is still to the left.
 */
export function gridSlot(boxes: readonly GridBox[], x: number, y: number, ignoreIndex: number): number {
  let slot = 0;
  boxes.forEach((box, index) => {
    if (index === ignoreIndex) return;
    const cy = box.top + box.height / 2;
    const cx = box.left + box.width / 2;
    const slack = box.height * 0.45;
    if (cy < y - slack || (Math.abs(cy - y) <= slack && cx < x)) slot += 1;
  });
  return slot;
}

export interface Sortable<T> {
  items: Accessor<T[]>;
  dragging: Accessor<SortableKey | null>;
  setContainer: (el: HTMLElement) => void;
  itemProps: (item: T) => { 'data-sortable-key': string };
  itemStyle: (item: T) => JSX.CSSProperties | undefined;
  isDragging: (item: T) => boolean;
  handleProps: (item: T) => {
    onPointerDown: (e: PointerEvent) => void;
    onKeyDown: (e: KeyboardEvent) => void;
    'aria-roledescription': string;
    style: JSX.CSSProperties;
  };
  /** Move an item by ±n slots programmatically (also what the arrow keys do). */
  move: (item: T, delta: number) => void;
}

const ATTR = 'data-sortable-key';
const EDGE = 48; // px from a scroll edge where auto-scroll kicks in
const MAX_SCROLL_SPEED = 18; // px per frame
const FLIP_MS = 160;

function scrollParent(el: HTMLElement | null): HTMLElement {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

export function createSortable<T>(options: SortableOptions<T>): Sortable<T> {
  const [items, setItems] = createSignal<T[]>([...options.items()]);
  const [dragging, setDragging] = createSignal<SortableKey | null>(null);
  const [offset, setOffset] = createSignal(0);
  const [offsetX, setOffsetX] = createSignal(0);
  let container: HTMLElement | undefined;
  let pendingSync: T[] | null = null;
  let abortDrag: (() => void) | null = null;
  onCleanup(() => abortDrag?.());

  // Follow the server list, but never yank the rows out from under an active drag; apply after the drop instead.
  // Not deferred on purpose: under <Suspense> the first run happens after the data resolved, and that first
  // value must land too.
  createEffect(
    on(options.items, (next) => {
      if (dragging() !== null) pendingSync = [...next];
      else setItems([...next]);
    }),
  );

  const enabled = () => options.enabled?.() ?? true;
  const usesGrid = () => options.flow?.() === 'grid';
  const keyOf = (item: T) => String(options.key(item));
  const rows = (): HTMLElement[] => (container ? Array.from(container.querySelectorAll<HTMLElement>(`:scope > [${ATTR}]`)) : []);
  const rowFor = (key: SortableKey) => rows().find((el) => el.getAttribute(ATTR) === String(key));
  /** Row top in container coordinates. An unpositioned container shares its rows' offsetParent, so subtract its own top. */
  const topOf = (el: HTMLElement) =>
    !container || el.offsetParent === container ? el.offsetTop : el.offsetTop - container.offsetTop;

  const commit = (next: T[], previous: T[]) => {
    const before = previous.map(keyOf).join('\u0000');
    const after = next.map(keyOf).join('\u0000');
    if (before === after) return;
    setItems(next);
    void options.onReorder(next, next.map((item) => options.key(item)));
  };

  /** Reorder the DOM list and animate the untouched rows from their old slot to the new one. */
  const applyOrder = (next: T[], draggedKey: SortableKey | null) => {
    if (usesGrid()) {
      const before = new Map(
        rows().map((el) => [el.getAttribute(ATTR) ?? '', { x: el.offsetLeft, y: el.offsetTop }] as const),
      );
      setItems(next);
      for (const el of rows()) {
        const k = el.getAttribute(ATTR) ?? '';
        if (k === String(draggedKey)) continue;
        const prev = before.get(k);
        if (!prev) continue;
        const dx = prev.x - el.offsetLeft;
        const dy = prev.y - el.offsetTop;
        if (dx === 0 && dy === 0) continue;
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        void el.offsetHeight;
        el.style.transition = `transform ${FLIP_MS}ms ease`;
        el.style.transform = '';
        const clear = () => {
          el.style.transition = '';
          el.removeEventListener('transitionend', clear);
        };
        el.addEventListener('transitionend', clear);
      }
      return;
    }
    const before = new Map(rows().map((el) => [el.getAttribute(ATTR) ?? '', el.offsetTop]));
    setItems(next);
    for (const el of rows()) {
      const k = el.getAttribute(ATTR) ?? '';
      if (k === String(draggedKey)) continue;
      const prev = before.get(k);
      if (prev === undefined) continue;
      const delta = prev - el.offsetTop;
      if (delta === 0) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      // Force the starting frame, then let it slide home.
      void el.offsetHeight;
      el.style.transition = `transform ${FLIP_MS}ms ease`;
      el.style.transform = '';
      const clear = () => {
        el.style.transition = '';
        el.removeEventListener('transitionend', clear);
      };
      el.addEventListener('transitionend', clear);
    }
  };

  const move = (item: T, delta: number) => {
    if (!enabled() || delta === 0) return;
    const current = items();
    const from = current.findIndex((x) => keyOf(x) === keyOf(item));
    if (from < 0) return;
    const to = Math.max(0, Math.min(current.length - 1, from + delta));
    if (to === from) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved as T);
    // Re-inserting a node drops focus; put it back on the handle so arrow keys keep working.
    const focused = document.activeElement as HTMLElement | null;
    applyOrder(next, null);
    if (focused && container?.contains(focused)) focused.focus({ preventScroll: false });
    commit(next, current);
  };

  const onPointerDown = (item: T) => (e: PointerEvent) => {
    if (!enabled() || !container || dragging() !== null) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const handle = e.currentTarget as HTMLElement;
    const key = options.key(item);
    const row = rowFor(key);
    if (!row) return;
    e.preventDefault();

    const startOrder = items();
    const containerTop = () => container!.getBoundingClientRect().top;
    const grabOffset = e.clientY - row.getBoundingClientRect().top;
    const grabOffsetX = e.clientX - row.getBoundingClientRect().left;
    const scroller = scrollParent(container);
    let lastX = e.clientX;
    let lastY = e.clientY;
    let frame = 0;
    let finished = false;

    setDragging(key);
    setOffset(0);
    setOffsetX(0);
    container.dataset.sorting = 'true';
    document.body.style.userSelect = 'none';
    // Capture is best-effort. Reordering moves the dragged row in the DOM (remove + insert), and browsers drop
    // pointer capture the moment the capturing element leaves the tree - so it is re-taken after every move and
    // never treated as the end of the drag. Move/up/cancel are tracked on window, which does not need capture.
    const capture = () => {
      try {
        if (!handle.hasPointerCapture(e.pointerId)) handle.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone or capture unsupported - the window listeners still see the rest of the drag */
      }
    };
    capture();

    const update = () => {
      if (!container) return;
      if (usesGrid()) {
        const rect = container.getBoundingClientRect();
        const x = lastX - rect.left + container.scrollLeft;
        const y = lastY - rect.top + container.scrollTop;
        const centreX = x - grabOffsetX + row.offsetWidth / 2;
        const centreY = y - grabOffset + row.offsetHeight / 2;
        const current = items();
        const currentIndex = current.findIndex((item) => keyOf(item) === String(key));
        const boxes = rows().map((el) => ({
          left: el.offsetLeft,
          top: el.offsetTop,
          width: el.offsetWidth,
          height: el.offsetHeight,
        }));
        const slot = gridSlot(boxes, centreX, centreY, rows().indexOf(row));
        if (slot !== currentIndex && currentIndex >= 0) {
          const next = [...current];
          const [moved] = next.splice(currentIndex, 1);
          next.splice(slot, 0, moved as T);
          applyOrder(next, key);
          capture();
        }
        setOffsetX(x - grabOffsetX - row.offsetLeft);
        setOffset(y - grabOffset - row.offsetTop);
        return;
      }
      const localY = lastY - containerTop() - grabOffset; // pointer-driven top of the dragged row, container coords
      const centre = localY + row.offsetHeight / 2;
      const current = items();
      const currentIndex = current.findIndex((x) => keyOf(x) === String(key));
      // Slot = number of other rows whose midpoint is above the dragged row's centre.
      let slot = 0;
      for (const el of rows()) {
        if (el === row) continue;
        if (topOf(el) + el.offsetHeight / 2 < centre) slot += 1;
      }
      if (slot !== currentIndex && currentIndex >= 0) {
        const next = [...current];
        const [moved] = next.splice(currentIndex, 1);
        next.splice(slot, 0, moved as T);
        applyOrder(next, key);
        capture();
      }
      const maxTop = Math.max(0, container.clientHeight - row.offsetHeight);
      const clamped = Math.max(0, Math.min(maxTop, localY));
      setOffset(clamped - topOf(row));
    };

    const autoScroll = () => {
      frame = 0;
      if (finished) return;
      const rect =
        scroller === document.documentElement || scroller === document.body
          ? { top: 0, bottom: window.innerHeight }
          : scroller.getBoundingClientRect();
      let dy = 0;
      if (lastY < rect.top + EDGE) dy = -Math.ceil(((rect.top + EDGE - lastY) / EDGE) * MAX_SCROLL_SPEED);
      else if (lastY > rect.bottom - EDGE) dy = Math.ceil(((lastY - (rect.bottom - EDGE)) / EDGE) * MAX_SCROLL_SPEED);
      if (dy !== 0) {
        const before = scroller.scrollTop;
        scroller.scrollTop += dy;
        if (scroller.scrollTop !== before) {
          update();
          frame = requestAnimationFrame(autoScroll);
        }
      }
    };

    const onMove = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      update();
      if (!frame) frame = requestAnimationFrame(autoScroll);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      abortDrag = null;
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      document.body.style.userSelect = '';
      if (container) delete container.dataset.sorting;
      setOffset(0);
      setOffsetX(0);
      setDragging(null);
      const final = items();
      commit(final, startOrder);
      if (pendingSync) {
        // A refetch landed mid-drag. Our drop wins if it changed something; otherwise adopt the fresh list.
        const fresh = pendingSync;
        pendingSync = null;
        if (final.map(keyOf).join() === startOrder.map(keyOf).join()) setItems(fresh);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    abortDrag = finish;
  };

  const onKeyDown = (item: T) => (e: KeyboardEvent) => {
    if (!enabled()) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || (usesGrid() && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
      e.preventDefault();
      const backward = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
      move(item, backward ? -1 : 1);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      move(item, e.key === 'Home' ? -items().length : items().length);
    }
  };

  return {
    items,
    dragging,
    setContainer: (el) => {
      container = el;
    },
    isDragging: (item) => dragging() !== null && String(dragging()) === keyOf(item),
    itemProps: (item) => ({ [ATTR]: keyOf(item) }),
    itemStyle: (item) => {
      if (dragging() === null || String(dragging()) !== keyOf(item)) return undefined;
      const shift = usesGrid() ? `translate(${offsetX()}px, ${offset()}px)` : `translateY(${offset()}px)`;
      return { transform: shift, transition: 'none', 'z-index': 2, position: 'relative' };
    },
    handleProps: (item) => ({
      onPointerDown: onPointerDown(item),
      onKeyDown: onKeyDown(item),
      'aria-roledescription': 'sortable',
      style: { 'touch-action': 'none' },
    }),
    move,
  };
}
