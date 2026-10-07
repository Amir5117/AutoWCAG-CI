"use client";

import dynamic from "next/dynamic";
import type { ReactDiffViewerStylesOverride } from "react-diff-viewer-continued";

// react-diff-viewer-continued uses a Web Worker, ResizeObserver, and refs
// for measurement -- none of which exist during Next.js's server render
// pass, so it has to be excluded from SSR entirely rather than just
// client-rendered.
const ReactDiffViewer = dynamic(() => import("react-diff-viewer-continued"), {
  ssr: false,
  loading: () => (
    <div className="h-48 w-full animate-pulse rounded-lg bg-muted" aria-hidden="true" />
  ),
});

const diffStyles: ReactDiffViewerStylesOverride = {
  variables: {
    light: {
      diffViewerBackground: "#ffffff",
      diffViewerColor: "var(--color-foreground)",
      addedBackground: "var(--color-diff-insert-bg)",
      addedColor: "var(--color-diff-insert-text)",
      removedBackground: "var(--color-diff-delete-bg)",
      removedColor: "var(--color-diff-delete-text)",
      wordAddedBackground: "var(--color-emerald-200)",
      wordRemovedBackground: "var(--color-rose-200)",
      addedGutterBackground: "var(--color-emerald-100)",
      removedGutterBackground: "var(--color-rose-100)",
      gutterBackground: "var(--color-muted)",
      gutterColor: "var(--color-muted-foreground)",
      codeFoldGutterBackground: "var(--color-muted)",
      codeFoldBackground: "var(--color-muted)",
    },
  },
  diffContainer: {
    fontSize: "13px",
    fontFamily: "var(--font-mono)",
  },
};

function guessHighlightLanguage(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "tsx" || ext === "jsx") return "jsx";
  if (ext === "ts") return "typescript";
  if (ext === "html") return "html";
  if (ext === "vue") return "html";
  return undefined;
}

export function PatchDiffViewer({
  filename,
  originalCode,
  patchedCode,
}: {
  filename: string;
  originalCode: string;
  patchedCode: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50/80 px-3 py-2">
        <span className="font-mono text-[13px] text-zinc-900 truncate">{filename}</span>
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Diff
        </span>
      </div>
      <div className="max-h-[480px] overflow-auto bg-white">
        <ReactDiffViewer
          oldValue={originalCode}
          newValue={patchedCode}
          splitView
          useDarkTheme={false}
          leftTitle="Original"
          rightTitle="AI-generated patch"
          highlightLanguage={guessHighlightLanguage(filename)}
          styles={diffStyles}
        />
      </div>
    </div>
  );
}
