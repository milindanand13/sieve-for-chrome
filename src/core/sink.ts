import type { DropSink, FeedItem, Platform } from "../types.js";

export function createSink(remove: boolean): DropSink {
  return { remove, reasons: new Map(), dimmed: [], hard: [] };
}

export function snippet(text: string, max = 120): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Records an unconditional removal (ad, shorts, promoted, suggested) for counting and logging. */
export function hardRemoval(
  sink: DropSink | undefined,
  site: Platform,
  reason: string,
  text = "",
): void {
  sink?.hard.push({ site, reason, text: snippet(text) });
}

/**
 * A graded or rule drop. Returns true when the adapter should remove the item from the JSON;
 * false when it should stay (dimmed by the content script). Without a sink, always remove.
 */
export function gradedDrop(sink: DropSink | undefined, item: FeedItem | undefined, id: string): boolean {
  if (!sink) return true;
  if (!sink.dimmed.some((e) => e.id === id)) {
    sink.dimmed.push({
      id,
      alt: item?.altId,
      site: item?.platform ?? "youtube",
      reason: sink.reasons.get(id) ?? "dropped",
      text: snippet(item?.titleOrText ?? ""),
    });
  }
  return sink.remove;
}
