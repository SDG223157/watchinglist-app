import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  fetchProcessRunDetail,
  type ProcessArtifact,
  type ProcessArtifactStatus,
  type ProcessRunStatus,
} from "@/lib/process-registry";

export const dynamic = "force-dynamic";

const RUN_STATUS_COLOR: Record<ProcessRunStatus, string> = {
  pending: "#60a5fa",
  running: "#eab308",
  blocked: "#f97316",
  failed: "#ef4444",
  completed: "#22c55e",
  superseded: "#a1a1aa",
};

const ARTIFACT_STATUS_COLOR: Record<ProcessArtifactStatus, string> = {
  needs_review: "#eab308",
  approved: "#22c55e",
  published: "#60a5fa",
  archived: "#a1a1aa",
};

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <details
      className="rounded-lg p-4"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <summary className="cursor-pointer text-sm font-semibold">{title}</summary>
      <pre
        className="mt-3 max-h-80 overflow-auto rounded-md p-3 text-[11px]"
        style={{
          background: "rgba(0,0,0,0.22)",
          border: "1px solid rgba(255,255,255,0.07)",
          color: "var(--muted)",
        }}
      >
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </details>
  );
}

function StatusForm({
  artifact,
  status,
  runId,
}: {
  artifact: ProcessArtifact;
  status: ProcessArtifactStatus;
  runId: number;
}) {
  return (
    <form action={`/api/processes/artifacts/${artifact.id}`} method="post">
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="redirect_to" value={`/processes/runs/${runId}`} />
      <button
        className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold hover:brightness-125"
        style={{
          background:
            artifact.status === status
              ? ARTIFACT_STATUS_COLOR[status]
              : "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          color: artifact.status === status ? "#020617" : "var(--muted)",
        }}
      >
        {status.replaceAll("_", " ")}
      </button>
    </form>
  );
}

export default async function ProcessRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const detail = await fetchProcessRunDetail(Number(id));
  if (!detail) notFound();

  const run = detail.run;
  const retryable = run.status === "failed" || run.status === "blocked";

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/processes/runs" className="text-sm hover:underline" style={{ color: "var(--blue)" }}>
            Run History
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Run #{run.id}: {run.registry_slug}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Immutable registry snapshot, retry policy, artifacts, and audit trail.
          </p>
        </div>
        {retryable ? (
          <form action={`/api/processes/runs/${run.id}/retry`} method="post">
            <input type="hidden" name="redirect_to" value={`/processes/runs/${run.id}`} />
            <button
              className="rounded-md px-3 py-2 text-xs font-semibold hover:brightness-125"
              style={{ background: "#2563eb", color: "#fff" }}
            >
              Retry Run
            </button>
          </form>
        ) : null}
      </header>

      <section className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["Status", run.status],
          ["Attempt", `${run.attempt}/${run.max_attempts}`],
          ["Timeout", run.timeout_ms ? `${run.timeout_ms}ms` : "none"],
          ["Backoff", `${run.retry_backoff_ms}ms`],
          ["Failure", run.failure_category ?? "none"],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg p-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              {label}
            </div>
            <div
              className="mt-1 font-mono text-lg font-semibold"
              style={label === "Status" ? { color: RUN_STATUS_COLOR[run.status] } : undefined}
            >
              {value}
            </div>
          </div>
        ))}
      </section>

      <section className="mb-5 grid gap-4 lg:grid-cols-2">
        <JsonBlock title="Inputs" value={run.inputs} />
        <JsonBlock title="Outputs" value={run.outputs} />
        <JsonBlock title="Frozen Registry Version" value={run.frozen_registry} />
        <JsonBlock title="Frozen Metadata Schema" value={run.frozen_metadata} />
        <JsonBlock title="Frozen Runner Config" value={run.frozen_runner} />
        <JsonBlock title="Runtime State" value={run.state} />
      </section>

      <section
        className="mb-5 rounded-lg p-5"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">Artifacts</h2>
          <Link href="/processes/artifacts" className="text-xs hover:underline" style={{ color: "var(--blue)" }}>
            Open Inbox
          </Link>
        </div>

        <div className="mt-4 grid gap-3">
          {detail.artifacts.map((artifact) => (
            <article
              key={artifact.id}
              className="rounded-lg p-4"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div className="font-mono text-xs" style={{ color: "var(--muted)" }}>
                #{artifact.id} / {artifact.artifact_type}
              </div>
              <h3 className="mt-1 font-semibold">{artifact.title}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["needs_review", "approved", "published", "archived"] as ProcessArtifactStatus[]).map(
                  (status) => (
                    <StatusForm key={status} artifact={artifact} status={status} runId={run.id} />
                  )
                )}
              </div>
              <JsonBlock title="Artifact JSON" value={artifact.json_content} />
            </article>
          ))}
          {!detail.artifacts.length ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              No artifacts have been written for this run yet.
            </p>
          ) : null}
        </div>
      </section>

      <section
        className="rounded-lg p-5"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h2 className="text-lg font-semibold tracking-tight">Audit Trail</h2>
        <div className="mt-4 grid gap-3">
          {detail.auditEvents.map((event) => (
            <div key={event.id} className="rounded-md p-3" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="font-mono text-xs" style={{ color: "var(--muted)" }}>
                {event.created_at} / {event.actor}
              </div>
              <div className="mt-1 text-sm font-semibold">{event.event_type}</div>
              <pre className="mt-2 overflow-auto text-[11px]" style={{ color: "var(--muted)" }}>
                {JSON.stringify(event.details, null, 2)}
              </pre>
            </div>
          ))}
          {!detail.auditEvents.length ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              No audit events matched this run.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
