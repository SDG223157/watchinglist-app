import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  fetchProcessRegistry,
  summarizeRegistry,
  type ProcessRegistryItem,
  type RegistryObjectType,
  type RegistryStatus,
} from "@/lib/process-registry";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<RegistryObjectType, string> = {
  skill: "Skill",
  pipeline: "Pipeline",
  process: "Process",
  application: "Application",
  template: "Template",
};

const STATUS_STYLES: Record<RegistryStatus, { bg: string; color: string }> = {
  active: { bg: "rgba(34,197,94,0.14)", color: "#22c55e" },
  review: { bg: "rgba(234,179,8,0.14)", color: "#eab308" },
  draft: { bg: "rgba(59,130,246,0.14)", color: "#60a5fa" },
  archived: { bg: "rgba(161,161,170,0.12)", color: "#a1a1aa" },
};

type RegistryAction = "run" | "edit" | "review" | "runs";

const ACTION_LABELS: Record<RegistryAction, string> = {
  run: "Run",
  edit: "Edit Draft",
  review: "Review",
  runs: "View Runs",
};

function getPrimaryAction(item: ProcessRegistryItem): RegistryAction {
  if (item.status === "active") return "run";
  if (item.status === "review") return "review";
  return "edit";
}

function getActionHref(item: ProcessRegistryItem, action: RegistryAction) {
  return `/processes?slug=${item.slug}&action=${action}`;
}

function isRegistryAction(value: string | undefined): value is RegistryAction {
  return value === "run" || value === "edit" || value === "review" || value === "runs";
}

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub: string;
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div
        className="text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--muted)" }}
      >
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold font-mono">{value}</div>
      <div className="text-xs" style={{ color: "var(--muted)" }}>
        {sub}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RegistryStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: style.bg, color: style.color }}
    >
      {status}
    </span>
  );
}

function RegistryCard({
  item,
  selected,
}: {
  item: ProcessRegistryItem;
  selected: boolean;
}) {
  const configEntries = Object.entries(item.config).slice(0, 3);
  const primaryAction = getPrimaryAction(item);

  return (
    <article
      className="rounded-lg p-5"
      style={{
        background: "var(--card)",
        border: selected ? "1px solid #3b82f6" : "1px solid var(--border)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--blue)" }}
          >
            {TYPE_LABELS[item.object_type]} / v{item.version}
          </div>
          <h2 className="mt-2 text-lg font-semibold tracking-tight">
            {item.name}
          </h2>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <p className="mt-3 min-h-[60px] text-sm leading-6" style={{ color: "var(--muted)" }}>
        {item.description}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {item.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-md px-2 py-1 text-[11px]"
            style={{
              background: "rgba(255,255,255,0.04)",
              color: "var(--muted)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {tag}
          </span>
        ))}
      </div>

      <dl className="mt-5 space-y-3">
        {configEntries.map(([key, value]) => (
          <div key={key}>
            <dt
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--muted)" }}
            >
              {key.replaceAll("_", " ")}
            </dt>
            <dd className="mt-1 truncate text-xs font-mono">
              {Array.isArray(value)
                ? value.join(" -> ")
                : JSON.stringify(value)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href={getActionHref(item, primaryAction)}
          className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors hover:brightness-125"
          style={{ background: "#2563eb", color: "#fff" }}
        >
          {ACTION_LABELS[primaryAction]}
        </Link>
        <Link
          href={getActionHref(item, "runs")}
          className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors hover:brightness-125"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--muted)",
          }}
        >
          View Runs
        </Link>
      </div>
    </article>
  );
}

function SelectedActionPanel({
  item,
  action,
}: {
  item: ProcessRegistryItem;
  action: RegistryAction;
}) {
  const actionCopy: Record<RegistryAction, { title: string; body: string; command: string }> = {
    run: {
      title: "Run Preview",
      body: "This object is active and ready for a runtime-backed execution step.",
      command: `create_process_run("${item.slug}", v${item.version})`,
    },
    edit: {
      title: "Draft Editor",
      body: "Draft objects can be changed before they are reviewed or activated.",
      command: `open_registry_editor("${item.slug}")`,
    },
    review: {
      title: "Review Gate",
      body: "Review objects are waiting for approval before becoming active.",
      command: `approve_registry_version("${item.slug}", v${item.version})`,
    },
    runs: {
      title: "Run History",
      body: "Run history will show status, inputs, outputs, artifacts, and failures for this object.",
      command: `list_process_runs("${item.slug}")`,
    },
  };

  const selected = actionCopy[action];

  return (
    <section
      className="mt-6 rounded-lg p-5"
      style={{ background: "var(--card)", border: "1px solid #3b82f6" }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--blue)" }}
          >
            {TYPE_LABELS[item.object_type]} / {item.status} / v{item.version}
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">
            {selected.title}: {item.name}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: "var(--muted)" }}>
            {selected.body}
          </p>
        </div>
        <Link
          href="/processes"
          className="w-fit rounded-md px-3 py-2 text-xs font-semibold transition-colors hover:brightness-125"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--muted)",
          }}
        >
          Clear
        </Link>
      </div>
      <div
        className="mt-4 rounded-lg p-4 font-mono text-xs"
        style={{
          background: "rgba(0,0,0,0.22)",
          border: "1px solid rgba(255,255,255,0.07)",
          color: "var(--text)",
        }}
      >
        {selected.command}
      </div>
    </section>
  );
}

function RegistryFlow() {
  const steps = ["Skill", "Pipeline", "Process", "Application"];

  return (
    <section
      className="rounded-lg p-5"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Database-Native Execution Spine
          </h2>
          <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--muted)" }}>
            Registry data defines capabilities, compositions, durable operating loops,
            and app surfaces. Runtime code reads the registry instead of hardcoding
            every workflow.
          </p>
        </div>
        <Link
          href="/api/processes"
          className="w-fit rounded-md px-3 py-2 text-xs font-semibold transition-colors hover:brightness-125"
          style={{ background: "#2563eb", color: "#fff" }}
        >
          View JSON
        </Link>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => (
          <div key={step} className="flex items-center gap-3">
            <div
              className="flex h-12 flex-1 items-center justify-center rounded-lg text-sm font-semibold"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              {step}
            </div>
            {index < steps.length - 1 && (
              <div className="hidden text-sm md:block" style={{ color: "var(--muted)" }}>
                -&gt;
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function ProcessesPage({
  searchParams,
}: {
  searchParams?: Promise<{ slug?: string; action?: string }>;
}) {
  const [session, items] = await Promise.all([auth(), fetchProcessRegistry()]);
  if (!session?.user) redirect("/login");

  const params = await searchParams;
  const selectedItem = items.find((item) => item.slug === params?.slug);
  const selectedAction = isRegistryAction(params?.action)
    ? params.action
    : selectedItem
      ? getPrimaryAction(selectedItem)
      : undefined;
  const summary = summarizeRegistry(items);

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/"
            className="text-sm hover:underline"
            style={{ color: "var(--blue)" }}
          >
            Dashboard
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Process Registry
          </h1>
          <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--muted)" }}>
            Data-driven skills, pipelines, processes, and applications for the
            WatchingList research operating layer.
          </p>
        </div>
        {session.user.image && (
          <img
            src={session.user.image}
            alt=""
            className="h-8 w-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatTile label="Objects" value={summary.total} sub="registry rows" />
        <StatTile label="Active" value={summary.active} sub="runnable" />
        <StatTile label="Review" value={summary.review} sub="needs approval" />
        <StatTile label="Draft" value={summary.draft} sub="editable" />
        <StatTile label="Skills" value={summary.byType.skill} sub="capabilities" />
        <StatTile label="Pipelines" value={summary.byType.pipeline} sub="graphs" />
      </section>

      <RegistryFlow />

      {selectedItem && selectedAction && (
        <SelectedActionPanel item={selectedItem} action={selectedAction} />
      )}

      <section className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <RegistryCard
            key={item.slug}
            item={item}
            selected={item.slug === selectedItem?.slug}
          />
        ))}
      </section>

      <footer className="mt-12 pb-8 text-right text-xs" style={{ color: "var(--muted)" }}>
        Registry definitions are loaded from the Process Registry database.
      </footer>
    </main>
  );
}
