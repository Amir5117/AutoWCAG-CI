export type DiffOpType = "equal" | "del" | "add";

export interface DiffOp {
  type: DiffOpType;
  text: string;
  oldNo: number | null;
  newNo: number | null;
  range?: [number, number];
}

const MAX_LCS_CELLS = 4_000_000;

function splitLines(source: string): string[] {
  if (source === "") return [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function lcsDiff(a: string[], b: string[]): { type: DiffOpType; text: string }[] {
  const n = a.length;
  const m = b.length;

  if (n === 0) return b.map((text) => ({ type: "add" as const, text }));
  if (m === 0) return a.map((text) => ({ type: "del" as const, text }));

  if (n * m > MAX_LCS_CELLS) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }

  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const ops: { type: DiffOpType; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", text: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ type: "del", text: a[i] });
      i++;
    } else {
      ops.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", text: a[i++] });
  while (j < m) ops.push({ type: "add", text: b[j++] });

  return ops;
}

function changedSpans(
  oldText: string,
  newText: string
): { old: [number, number]; new: [number, number] } | null {
  const max = Math.min(oldText.length, newText.length);

  let prefix = 0;
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < max - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }

  if (prefix === 0 && suffix === 0) return null;

  return {
    old: [prefix, oldText.length - suffix],
    new: [prefix, newText.length - suffix],
  };
}

export function diffLines(oldCode: string, newCode: string): DiffOp[] {
  const a = splitLines(oldCode);
  const b = splitLines(newCode);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const raw: { type: DiffOpType; text: string }[] = [
    ...a.slice(0, start).map((text) => ({ type: "equal" as const, text })),
    ...lcsDiff(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((text) => ({ type: "equal" as const, text })),
  ];

  let oldNo = 0;
  let newNo = 0;
  const ops: DiffOp[] = raw.map((op) => {
    if (op.type === "equal") return { ...op, oldNo: ++oldNo, newNo: ++newNo };
    if (op.type === "del") return { ...op, oldNo: ++oldNo, newNo: null };
    return { ...op, oldNo: null, newNo: ++newNo };
  });

  let i = 0;
  while (i < ops.length) {
    if (ops[i].type !== "del") {
      i++;
      continue;
    }
    const delStart = i;
    while (i < ops.length && ops[i].type === "del") i++;
    const addStart = i;
    while (i < ops.length && ops[i].type === "add") i++;

    const pairs = Math.min(addStart - delStart, i - addStart);
    for (let k = 0; k < pairs; k++) {
      const spans = changedSpans(ops[delStart + k].text, ops[addStart + k].text);
      if (spans) {
        ops[delStart + k].range = spans.old;
        ops[addStart + k].range = spans.new;
      }
    }
  }

  return ops;
}

export function diffStats(ops: DiffOp[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.type === "add") additions++;
    else if (op.type === "del") deletions++;
  }
  return { additions, deletions };
}
