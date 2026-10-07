"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown, FileCode2, GitMerge, LoaderCircle } from "lucide-react";
import { PatchStatusBadge } from "@/components/patch-status-badge";
import { diffLines, diffStats, type DiffOp } from "@/lib/line-diff";

const CONTEXT_LINES = 3;

const TOKEN_PATTERN =
  /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?[A-Za-z][\w.:-]*|\/?>)|(\b(?:function|return|const|let|var|import|from|export|default|if|else|new|class|extends)\b)|(\b[A-Za-z_][\w:-]*(?==))/g;

const TOKEN_CLASSES = [
  "text-zinc-400 italic",
  "text-sky-700",
  "text-violet-700",
  "text-rose-600",
  "text-amber-700",
];

const ROW_STYLES = {
  equal: {
    row: "",
    gutter: "bg-zinc-50/70 text-zinc-400",
    edge: "border-transparent",
    marker: "",
    marked: "",
    label: "",
  },
  add: {
    row: "bg-diff-insert-bg",
    gutter: "bg-emerald-100/70 text-emerald-700/70",
    edge: "border-emerald-400",
    marker: "+",
    marked: "bg-emerald-200/80",
    label: "Added: ",
  },
  del: {
    row: "bg-diff-delete-bg",
    gutter: "bg-rose-100/70 text-rose-700/70",
    edge: "border-rose-400",
    marker: "−",
    marked: "bg-rose-200/80",
    label: "Removed: ",
  },
} as const;

interface Segment {
  text: string;
  className: string;
  marked: boolean;
}

type Row = { kind: "line"; op: DiffOp } | { kind: "gap"; id: number; count: number };

function tokenize(line: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ text: line.slice(cursor, index), className: "", marked: false });
    }
    const group = match.slice(1).findIndex((value) => value !== undefined);
    segments.push({ text: match[0], className: TOKEN_CLASSES[group], marked: false });
    cursor = index + match[0].length;
  }

  if (cursor < line.length) {
    segments.push({ text: line.slice(cursor), className: "", marked: false });
  }

  return segments;
}

function markRange(segments: Segment[], range?: [number, number]): Segment[] {
  if (!range || range[0] >= range[1]) return segments;

  const [start, end] = range;
  const result: Segment[] = [];
  let offset = 0;

  for (const segment of segments) {
    const segStart = offset;
    const segEnd = offset + segment.text.length;
    offset = segEnd;

    const from = Math.max(start, segStart);
    const to = Math.min(end, segEnd);

    if (from >= to) {
      result.push(segment);
      continue;
    }
    if (from > segStart) {
      result.push({ ...segment, text: segment.text.slice(0, from - segStart) });
    }
    result.push({ ...segment, text: segment.text.slice(from - segStart, to - segStart), marked: true });
    if (to < segEnd) {
      result.push({ ...segment, text: segment.text.slice(to - segStart) });
    }
  }

  return result;
}

function buildRows(ops: DiffOp[], expanded: Set<number>, hasChanges: boolean): Row[] {
  if (!hasChanges) return ops.map((op) => ({ kind: "line", op }));

  const visible = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, index) => {
    if (op.type === "equal") return;
    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(ops.length - 1, index + CONTEXT_LINES);
    for (let k = from; k <= to; k++) visible[k] = true;
  });

  const rows: Row[] = [];
  let i = 0;
  while (i < ops.length) {
    if (visible[i]) {
      rows.push({ kind: "line", op: ops[i] });
      i++;
      continue;
    }
    const start = i;
    while (i < ops.length && !visible[i]) i++;
    if (expanded.has(start)) {
      for (let k = start; k < i; k++) rows.push({ kind: "line", op: ops[k] });
    } else {
      rows.push({ kind: "gap", id: start, count: i - start });
    }
  }
  return rows;
}

function DiffLine({ op }: { op: DiffOp }) {
  const style = ROW_STYLES[op.type];
  const segments = markRange(tokenize(op.text), op.range);

  return (
    <tr className={style.row}>
      <td className={`w-12 min-w-12 select-none border-l-2 pr-3 text-right align-top ${style.edge} ${style.gutter}`}>
        {op.oldNo}
      </td>
      <td className={`w-12 min-w-12 select-none pr-3 text-right align-top ${style.gutter}`}>
        {op.newNo}
      </td>
      <td className="w-6 select-none text-center align-top font-medium">
        <span aria-hidden="true" className={op.type === "add" ? "text-emerald-700" : "text-rose-700"}>
          {style.marker}
        </span>
        {style.label && <span className="sr-only">{style.label}</span>}
      </td>
      <td className="pr-6 align-top whitespace-pre text-zinc-800">
        {segments.length === 0 ? "​" : null}
        {segments.map((segment, index) => (
          <span
            key={index}
            className={`${segment.className} ${segment.marked ? `rounded-[3px] ${style.marked}` : ""}`}
          >
            {segment.text}
          </span>
        ))}
      </td>
    </tr>
  );
}

export function PatchDiffViewer({
  filename,
  originalCode,
  patchedCode,
  status,
  isApproving,
  onApprove,
}: {
  filename: string;
  originalCode: string;
  patchedCode: string;
  status: string;
  isApproving: boolean;
  onApprove: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const diff = useMemo(() => {
    try {
      const ops = diffLines(originalCode, patchedCode);
      return { ops, ...diffStats(ops) };
    } catch {
      return null;
    }
  }, [originalCode, patchedCode]);

  const hasChanges = diff ? diff.additions + diff.deletions > 0 : false;
  const rows = useMemo(
    () => (diff ? buildRows(diff.ops, expanded, hasChanges) : []),
    [diff, expanded, hasChanges]
  );

  const slash = filename.lastIndexOf("/");
  const directory = filename.slice(0, slash + 1);
  const baseName = filename.slice(slash + 1);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50/60 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileCode2 className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
          <span className="truncate font-mono text-[13px]">
            <span className="text-zinc-400">{directory}</span>
            <span className="font-medium text-zinc-900">{baseName}</span>
          </span>
          {diff && (
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
              <span className="text-emerald-600">+{diff.additions}</span>
              <span className="text-rose-600">−{diff.deletions}</span>
            </span>
          )}
        </div>

        {status === "merged" ? (
          <PatchStatusBadge status={status} />
        ) : (
          <button
            type="button"
            disabled={isApproving}
            onClick={onApprove}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.25)] transition hover:bg-zinc-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isApproving ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <GitMerge className="size-4" aria-hidden="true" />
            )}
            {isApproving ? "Applying fix…" : "Approve & Merge Fix"}
          </button>
        )}
      </div>

      {diff && !hasChanges && (
        <p className="border-b border-zinc-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          The suggested fix is identical to the current code.
        </p>
      )}

      <div
        role="region"
        aria-label="Code changes"
        tabIndex={0}
        className="max-h-[min(60vh,560px)] overflow-auto bg-white"
      >
        {diff ? (
          <table className="w-full min-w-max border-collapse font-mono text-[12.5px] leading-[22px]">
            <tbody>
              {rows.map((row) =>
                row.kind === "line" ? (
                  <DiffLine key={`${row.op.oldNo ?? "x"}-${row.op.newNo ?? "x"}`} op={row.op} />
                ) : (
                  <tr key={`gap-${row.id}`}>
                    <td colSpan={4} className="border-y border-zinc-100 bg-zinc-50/70 p-0">
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => new Set(prev).add(row.id))}
                        className="flex w-full items-center gap-2 px-4 py-1 text-left font-sans text-[11.5px] text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
                      >
                        <ChevronsUpDown className="size-3" aria-hidden="true" />
                        Show {row.count} unchanged {row.count === 1 ? "line" : "lines"}
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        ) : (
          <pre className="p-4 font-mono text-[12.5px] leading-[22px] whitespace-pre text-zinc-800">
            {patchedCode}
          </pre>
        )}
      </div>
    </div>
  );
}
