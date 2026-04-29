import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  fetchProcessArtifacts,
  type ProcessArtifact,
  type ProcessArtifactStatus,
} from "@/lib/process-registry";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS: ProcessArtifactStatus[] = [
  "needs_review",
  "approved",
  "published",
  "archived",
];

const STATUS_COLOR: Record<ProcessArtifactStatus, string> = {
  needs_review: "#eab308",
  approved: "#22c55e",
  published: "#60a5fa",
  archived: "#a1a1aa",
};

function isArtifactStatus(value: string | undefined): value is ProcessArtifactStatus {
  return Boolean(value && STATUS_OPTIONS.includes(value as ProcessArtifactStatus));
}

function artifactSummary(artifact: ProcessArtifact) {
  const content = artifact.json_content ?? {};
  if (typeof content.markdown === "string") return content.markdown.slice(0, 360);
  if (typeof content.summary_md === "string") return content.summary_md.slice(0, 360);
  if (typeof content.brief_md === "string") return content.brief_md.slice(0, 360);
  return JSON.stringify(content, null, 2).slice(0, 360);
}

function StatusForm({
  artifact,
  status,
}: {
  artifact: ProcessArtifact;
  status: ProcessArtifactStatus;
}) {
  return (
    <form action={`/api/processes/artifacts/${artifact.id}`} method="post">
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="redirect_to" value="/processes/artifacts" />
      <button
        className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold hover:brightness-125"
        style={{
          background: artifact.status === status ? STATUS_COLOR[status] : "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          color: artifact.status === status ? "#020617" : "var(--muted)",
        }}
      >
        {status.replaceAll("_", " ")}
      </button>
    </form>
  );
}

export default async function ArtifactInboxPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; slug?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const params = await searchParams;
  const status = isArtifactStatus(params?.status) ? params.status : undefined;
  const artifacts = await fetchProcessArtifacts(status, params?.slug, 120);

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/processes" className="text-sm hover:underline" style={{ color: "var(--blue)" }}>
            Process Registry
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Artifact Inbox</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Review durable WPR outputs, approve useful artifacts, publish finished assets, or archive stale output.
          </p>
        </div>
        <Link
          href="/processes/runs"
          className="rounded-md px-3 py-2 text-xs font-semibold"
          style={{ background: "#2563eb", color: "#fff" }}
        >
          Run History
        </Link>
      </header>

      <nav className="mb-5 flex flex-wrap gap-2">
        <Link
          href="/processes/artifacts"
          className="rounded-md px-3 py-2 text-xs font-semibold"
          style={{
            background: !status ? "#2563eb" : "rgba(255,255,255,0.04)",
            color: !status ? "#fff" : "var(--muted)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          all
        </Link>
        {STATUS_OPTIONS.map((option) => (
          <Link
            key={option}
            href={`/processes/artifacts?status=${option}`}
            className="rounded-md px-3 py-2 text-xs font-semibold"
            style={{
              background: status === option ? STATUS_COLOR[option] : "rgba(255,255,255,0.04)",
              color: status === option ? "#020617" : "var(--muted)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {option.replaceAll("_", " ")}
          </Link>
        ))}
      </nav>

      <section className="grid gap-4 lg:grid-cols-2">
        {artifacts.map((artifact) => (
          <article
            key={artifact.id}
            className="rounded-lg p-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="font-mono text-xs" style={{ color: "var(--muted)" }}>
                  #{artifact.id} / {artifact.registry_slug ?? "task"} / {artifact.artifact_type}
                </div>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">{artifact.title}</h2>
                <div className="mt-2 flex flex-wrap gap-2 text-xs" style={{ color: "var(--muted)" }}>
                  <span style={{ color: STATUS_COLOR[artifact.status] }}>{artifact.status}</span>
                  {artifact.run_id ? (
                    <Link href={`/processes/runs/${artifact.run_id}`} className="hover:underline">
                      run #{artifact.run_id}
                    </Link>
                  ) : null}
                  {artifact.run_status ? <span>run {artifact.run_status}</span> : null}
                </div>
              </div>
            </div>

            <p className="mt-3 whitespace-pre-wrap text-sm leading-6" style={{ color: "var(--muted)" }}>
              {artifactSummary(artifact)}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((option) => (
                <StatusForm key={option} artifact={artifact} status={option} />
              ))}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
