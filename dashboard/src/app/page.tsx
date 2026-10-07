"use client";

import { useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { CircleCheck, FlaskConical, Gauge, ShieldCheck } from "lucide-react";
import type { Patch } from "@/types/patch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardContent, CardDescription } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { PatchDiffViewer } from "@/components/patch-diff-viewer";
import { getDashboardStats, type DashboardStats } from "@/lib/actions/stats";

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim();
  if (!source) return "?";
  const parts = source.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function buildRoiKpis(stats: DashboardStats) {
  return [
    { label: "Manual Hours Saved", value: `${stats.hoursSaved}h`, accent: true },
    {
      label: "AI Acceptance Rate",
      value: `${stats.passRate}%`,
      accent: false,
      description: "% of AI-generated patches approved by human reviewers",
    },
    { label: "Violations Cleared", value: `${stats.totalCleared}`, accent: false },
    { label: "Active PRs Monitored", value: `${stats.prsMonitored}`, accent: false },
  ];
}

const fixesTrendConfig = {
  fixes: {
    label: "Fixes Merged",
    color: "var(--color-success)",
  },
} satisfies ChartConfig;

export default function Page() {
  const { data: session, status: sessionStatus } = useSession();

  const [patches, setPatches] = useState<Patch[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;

    let cancelled = false;

    fetch("/api/patches")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load patches");
        return res.json();
      })
      .then((data: Patch[]) => {
        if (!cancelled) setPatches(data);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load pending patches. Is the dev server running?");
      });

    return () => {
      cancelled = true;
    };
  }, [sessionStatus]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!statsOpen) return;

    let cancelled = false;

    getDashboardStats()
      .then((data) => {
        if (!cancelled) {
          setStats(data);
          setStatsError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setStatsError("Couldn't load ROI metrics.");
      });

    return () => {
      cancelled = true;
    };
  }, [statsOpen]);

  const pendingPatches = patches?.filter((p) => p.status === "pending") ?? [];
  const activePatch =
    pendingPatches.find((p) => p.id === activeId) ?? pendingPatches[0] ?? null;

  async function handleApprove(id: string) {
    setApprovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/patches/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to approve");
      const updated: Patch = await res.json();
      setPatches((prev) =>
        prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev
      );
      setToast(`${updated.file} merged into main`);
    } catch {
      setError("Failed to merge that patch. Try again.");
    } finally {
      setApprovingId(null);
    }
  }

  const isLoading = patches === null;

  if (sessionStatus === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-7 w-7 animate-pulse rounded-md bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (sessionStatus === "unauthenticated") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <ShieldCheck className="h-4 w-4 text-primary-foreground" aria-hidden="true" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold tracking-tight text-foreground">
              AutoWCAG-CI
            </span>
            <span className="text-sm text-muted-foreground">Remediation Center</span>
          </div>
        </div>

        <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-lg border border-border bg-card px-10 py-10 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            Sign in to review and approve AI-generated accessibility patches.
          </p>
          <Button size="lg" className="gap-2" onClick={() => signIn("github")}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            Sign in with GitHub
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <ShieldCheck className="h-4 w-4 text-primary-foreground" aria-hidden="true" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight text-foreground">
              AutoWCAG-CI
            </span>
            <span className="text-sm text-muted-foreground">Remediation Center</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-zinc-400">
              <Avatar className="border border-border">
                <AvatarImage
                  src={session?.user?.image ?? undefined}
                  alt={session?.user?.name ?? "Signed-in user avatar"}
                />
                <AvatarFallback>
                  {getInitials(session?.user?.name, session?.user?.email)}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(e) => e.preventDefault()}
              className="w-56 bg-white border border-zinc-200 shadow-md rounded-md p-1 animate-in fade-in zoom-in-95"
            >
              <DropdownMenuLabel>
                {session?.user?.name ?? session?.user?.email ?? "Account"}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer transition-colors hover:bg-zinc-100 rounded-sm"
                onSelect={(e) => {
                  e.preventDefault();
                  setSettingsOpen(true);
                }}
              >
                Account Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer transition-colors hover:bg-zinc-100 rounded-sm"
                onSelect={(e) => {
                  e.preventDefault();
                  setStatsOpen(true);
                }}
              >
                My Stats
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer transition-colors hover:bg-zinc-100 rounded-sm"
                onClick={() => signOut()}
              >
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* My Stats */}
      <Sheet open={statsOpen} onOpenChange={setStatsOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>ROI Analytics Dashboard</SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-6 px-4 pb-6">
            {statsError && (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-danger">
                {statsError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              {stats === null
                ? Array.from({ length: 4 }, (_, i) => (
                    <Card key={i} className="gap-1 py-4">
                      <CardHeader className="px-4">
                        <div className="h-3 w-24 animate-pulse rounded-xs bg-muted" />
                      </CardHeader>
                      <CardContent className="px-4">
                        <div className="h-7 w-16 animate-pulse rounded-xs bg-muted" />
                      </CardContent>
                    </Card>
                  ))
                : buildRoiKpis(stats).map((kpi) => (
                    <Card key={kpi.label} className="gap-1 py-4">
                      <CardHeader className="px-4">
                        <CardDescription
                          className="text-xs font-medium tracking-wide text-zinc-500 uppercase"
                          title={kpi.description}
                        >
                          {kpi.label}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="px-4">
                        <p
                          className={`text-2xl font-semibold tracking-tight ${
                            kpi.accent ? "text-emerald-600" : "text-foreground"
                          }`}
                        >
                          {kpi.value}
                        </p>
                        {kpi.description && (
                          <p className="mt-1 text-xs text-zinc-400">{kpi.description}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
            </div>

            <div>
              <p className="mb-3 text-sm font-medium text-foreground">
                Fixes Merged Over Time
              </p>
              <ChartContainer config={fixesTrendConfig} className="h-[220px] w-full">
                <AreaChart
                  data={stats?.chartData ?? []}
                  margin={{ left: 0, right: 0, top: 8, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--color-zinc-200)" />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} width={24} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    dataKey="fixes"
                    type="monotone"
                    fill="var(--color-fixes)"
                    fillOpacity={0.15}
                    stroke="var(--color-fixes)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Account Settings */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Repository Policies</DialogTitle>
            <DialogDescription>
              Configure automated remediation rules for this repository.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="auto-approve-safe-patches">
                  Auto-Approve Safe Patches
                </Label>
                <p className="text-sm text-muted-foreground">
                  Automatically merge patches that achieve High Confidence and pass the
                  Playwright sandbox.
                </p>
              </div>
              <Switch id="auto-approve-safe-patches" defaultChecked />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="strict-compliance-mode">Strict Compliance Mode</Label>
                <p className="text-sm text-muted-foreground">
                  Block pull requests from merging if critical accessibility violations
                  remain unfixed.
                </p>
              </div>
              <Switch id="strict-compliance-mode" />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="sandbox-failure-alerts">Sandbox Failure Alerts</Label>
                <p className="text-sm text-muted-foreground">
                  Send a webhook notification if an AI-generated patch fails validation
                  on its final retry.
                </p>
              </div>
              <Switch id="sandbox-failure-alerts" defaultChecked />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" onClick={() => setSettingsOpen(false)}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50">
          <div className="px-4 py-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Pending Patches — {isLoading ? "…" : pendingPatches.length}
          </div>
          <Separator />
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
            {isLoading &&
              [0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-1.5 rounded-md px-3 py-2.5 pl-4">
                  <div className="h-3.5 w-32 animate-pulse rounded-xs bg-muted" />
                  <div className="h-3 w-24 animate-pulse rounded-xs bg-muted" />
                </div>
              ))}

            {!isLoading && pendingPatches.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">Nothing pending.</p>
            )}

            {!isLoading &&
              pendingPatches.map((patch) => {
                const isActive = patch.id === activePatch?.id;
                return (
                  <button
                    key={patch.id}
                    type="button"
                    onClick={() => setActiveId(patch.id)}
                    className={
                      isActive
                        ? "group flex flex-col gap-1 px-3 py-2.5 rounded-md border border-zinc-200 bg-zinc-50 border-l-2 border-l-zinc-900 shadow-sm cursor-pointer text-left"
                        : "group flex flex-col gap-1 px-3 py-2.5 rounded-md border border-transparent hover:bg-zinc-100/80 cursor-pointer transition-colors text-left"
                    }
                  >
                    <span className="font-mono text-[13px] text-zinc-900 truncate">
                      {patch.file}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                      {patch.ruleId}
                    </span>
                  </button>
                );
              })}
          </nav>
        </aside>

        {/* Detail pane */}
        <main className="flex flex-1 flex-col overflow-y-auto bg-white">
          <div className="flex-1 px-8 py-6">
            {error && (
              <div className="mb-6 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-danger">
                {error}
              </div>
            )}

            {isLoading && (
              <div className="flex flex-col gap-4">
                <div className="h-5 w-40 animate-pulse rounded-xs bg-muted" />
                <div className="h-8 w-64 animate-pulse rounded-xs bg-muted" />
                <div className="h-48 w-full animate-pulse rounded-lg bg-muted" />
              </div>
            )}

            {!isLoading && !activePatch && (
              <div className="flex flex-col items-center justify-center rounded-lg bg-muted px-12 py-16 text-center">
                <p className="text-sm font-medium text-foreground">All caught up</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  No pending patches left to review.
                </p>
              </div>
            )}

            {!isLoading && activePatch && (
              <>
                {/* Command bar */}
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                        {activePatch.file}
                      </h1>
                      <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-800 border-zinc-200 font-mono">
                        <FlaskConical className="h-3 w-3" aria-hidden="true" />
                        {activePatch.ruleId}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      AI-generated patch resolves 1 axe-core violation. Review the diff below
                      before merging.
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      disabled={approvingId === activePatch.id}
                      className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-400 transition-colors disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={approvingId === activePatch.id}
                      onClick={() => handleApprove(activePatch.id)}
                      className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-50 transition-colors"
                    >
                      {approvingId === activePatch.id ? "Merging…" : "Approve & Merge"}
                    </button>
                  </div>
                </div>

                {/* Status strip */}
                <div className="mb-6 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
                    <Gauge className="h-3 w-3" aria-hidden="true" />
                    Confidence: High
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium bg-zinc-50 text-zinc-700 border-zinc-200">
                    Risk: Low
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
                    <CircleCheck className="h-3 w-3" aria-hidden="true" />
                    Sandbox: Passed
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 border-violet-200">
                    AI-generated
                  </span>
                </div>

                <PatchDiffViewer
                  filename={activePatch.file}
                  originalCode={activePatch.originalCode}
                  patchedCode={activePatch.patchedCode}
                />
              </>
            )}
          </div>
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed right-6 bottom-6 flex items-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm text-foreground shadow-lg">
          <CircleCheck className="h-4 w-4 text-success" aria-hidden="true" />
          {toast}
        </div>
      )}
    </div>
  );
}
