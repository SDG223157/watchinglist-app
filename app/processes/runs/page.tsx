import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { fetchProcessRuns, type ProcessRunStatus } from "@/lib/process-registry";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<ProcessRunStatus, string> = {
  pending: "#60a5fa",
  running: "#eab308",
  blocked: "#f97316",
  failed: "#ef4444",
  completed: "#22c55e",
  superseded: "#a1a1aa",
};

function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre
      className="mt-2 max-h-24 overflow-auto rounded-md p-3 text-[11px]"
      style={{
        background: "rgba(0,0,0,0.22)",
        border: "1px solid rgba(255,255,255,0.07)",
        color: "var(--muted)",
      }}
    >
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

export default async function ProcessRunsPage({
  searchParams,
}: {
  searchParams?: Promise<{ slug?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const params = await searchParams;
  const runs = await fetchProcessRuns(params?.slug, 75);

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/processes" className="text-sm hover:underline" style={{ color: "var(--blue)" }}>
            Process Registry
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Run History</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Inspect attempts, retry state, frozen versions, outputs, and artifacts.
          </p>
        </div>
        <Link
          href="/processes/artifacts"
          className="rounded-md px-3 py-2 text-xs font-semibold"
          style={{ background: "#2563eb", color: "#fff" }}
        >
          Artifact Inbox
        </Link>
      </header>

      <section className="grid gap-3">
        {runs.map((run) => (
          <article
            key={run.id}
            className="rounded-lg p-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="font-mono text-xs" style={{ color: "var(--muted)" }}>
                  #{run.id} / {run.registry_slug} / v{run.registry_version}
                  {run.registry_version_id ? ` #${run.registry_version_id}` : ""}
                </div>
                <Link
                  href={`/processes/runs/${run.id}`}
                  className="mt-1 block text-lg font-semibold tracking-tight hover:underline"
                >
                  {run.registry_slug}
                </Link>
                <div className="mt-2 flex flex-wrap gap-2 text-xs" style={{ color: "var(--muted)" }}>
                  <span style={{ color: STATUS_COLOR[run.status] }}>{run.status}</span>
                  <span>attempt {run.attempt}/{run.max_attempts}</span>
                  {run.timeout_ms ? <span>timeout {run.timeout_ms}ms</span> : null}
                  {run.failure_category ? <span>failure {run.failure_category}</span> : null}
                  {run.next_retry_at ? <span>next retry {run.next_retry_at}</span> : null}
                </div>
              </div>
              <Link
                href={`/processes/runs/${run.id}`}
                className="w-fit rounded-md px-3 py-2 text-xs font-semibold"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "var(--muted)",
                }}
              >
                Open Detail
              </Link>
            </div>
            <JsonPreview value={run.outputs && Object.keys(run.outputs).length ? run.outputs : run.inputs} />
          </article>
        ))}
      </section>
    </main>
  );
}
