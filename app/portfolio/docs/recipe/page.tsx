import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Recipe Portfolio — Documentation",
  description:
    "How the Recipe Portfolio allocation engine works: Bayesian updating, Transfer Entropy, and vector Kelly applied to a 30-stock book.",
};

// ---------------------------------------------------------------------------
// Small presentational helpers (no client code — this is a static doc page)
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-10 scroll-mt-20">
      <h2 className="text-xl font-bold tracking-tight mb-3">{title}</h2>
      <div className="text-sm text-zinc-300 leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  );
}

function Card({
  title,
  children,
  accent = "#2563eb",
}: {
  title: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--card)", border: `1px solid var(--border)` }}
    >
      <div
        className="text-[11px] uppercase tracking-wider font-bold mb-2"
        style={{ color: accent }}
      >
        {title}
      </div>
      <div className="text-xs text-zinc-300 leading-relaxed space-y-2">
        {children}
      </div>
    </div>
  );
}

function TierBadge({
  tier,
}: {
  tier: "anchor" | "follower" | "tactical" | "trim";
}) {
  const col =
    tier === "anchor"
      ? "#2563eb"
      : tier === "follower"
      ? "#059669"
      : tier === "tactical"
      ? "#d97706"
      : "#71717a";
  return (
    <span
      className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded font-mono"
      style={{ color: col, background: `${col}20` }}
    >
      {tier}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RecipeDocsPage() {
  return (
    <main className="max-w-[960px] mx-auto px-4 py-8">
      <header className="mb-8">
        <Link
          href="/portfolio"
          className="text-zinc-500 hover:text-zinc-300 text-sm"
        >
          ← Portfolio Builder
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">
          Recipe Portfolio — Documentation
        </h1>
        <p className="text-sm text-zinc-400 mt-2 max-w-2xl leading-relaxed">
          Bayesian updating + Schreiber Transfer Entropy + vector Kelly applied
          to a 30-stock book, plus the kitchen analogy that ties the three
          formulas into one operational framework.
        </p>
      </header>

      {/* Table of contents */}
      <nav
        className="rounded-lg p-4 mb-10"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">
          Contents
        </div>
        <ol className="text-sm text-zinc-300 space-y-1 list-decimal list-inside">
          <li>
            <a href="#what" className="hover:text-blue-400">
              What this tab does
            </a>
          </li>
          <li>
            <a href="#quickstart" className="hover:text-blue-400">
              Quick start
            </a>
          </li>
          <li>
            <a href="#tiers" className="hover:text-blue-400">
              The three active tiers (anchor / follower / tactical)
            </a>
          </li>
          <li>
            <a href="#numbers" className="hover:text-blue-400">
              The three key numbers (μ prior / μ post / TE)
            </a>
          </li>
          <li>
            <a href="#reading" className="hover:text-blue-400">
              Reading the allocation output
            </a>
          </li>
          <li>
            <a href="#alerts" className="hover:text-blue-400">
              Rotation panel + alert banner
            </a>
          </li>
          <li>
            <a href="#cadence" className="hover:text-blue-400">
              Update frequency (daily / weekly / quarterly)
            </a>
          </li>
          <li>
            <a href="#exceptions" className="hover:text-blue-400">
              When to override the cadence
            </a>
          </li>
          <li>
            <a href="#faq" className="hover:text-blue-400">
              FAQ and common pitfalls
            </a>
          </li>
        </ol>
      </nav>

      <Section id="what" title="1. What this tab does">
        <p>
          The Recipe Portfolio takes the{" "}
          <strong>actionable slice of your watchlist</strong> — names tagged{" "}
          <code className="text-[11px] bg-zinc-800 px-1 rounded">
            left-side
          </code>{" "}
          or{" "}
          <code className="text-[11px] bg-zinc-800 px-1 rounded">
            right-side
          </code>{" "}
          with a composite score ≥ 50 — and produces a disciplined allocation
          by running three pieces of quant-finance machinery in sequence:
        </p>
        <ol className="list-decimal list-inside pl-2 space-y-1">
          <li>
            <strong>Bayesian μ update</strong> — blend a fundamental prior
            (from the composite score) with 2-year observed daily excess
            returns to produce a posterior expected return per name.
          </li>
          <li>
            <strong>Vector Kelly with shrinkage</strong> — solve{" "}
            <code className="text-[11px] bg-zinc-800 px-1 rounded">
              w* = Σ⁻¹ μ_post
            </code>{" "}
            on a Ledoit-Wolf-shrunk covariance matrix, apply a quarter-Kelly
            fractionation, then enforce three caps: 7 % per name, 30 % per
            sector, 20 % per correlation cluster (ρ ≥ 0.70).
          </li>
          <li>
            <strong>Transfer Entropy (Schreiber 2000)</strong> — measure
            directional information flow from each held name into the rest of
            the book to identify which positions are{" "}
            <em>informationally leading</em> versus merely popular.
          </li>
        </ol>
        <p>
          The kitchen analogy that ties the three together: your portfolio is{" "}
          <strong>one menu, prepared in one kitchen, with finite counter
          space</strong>. Recipes share ingredients (correlation), prep times
          lead each other (Transfer Entropy), and every plate that goes out
          occupies space another plate cannot (Kelly). Size for survival,
          not for conviction.
        </p>
      </Section>

      <Section id="quickstart" title="2. Quick start">
        <ol className="list-decimal list-inside pl-2 space-y-2">
          <li>
            Pick a <strong>market</strong> (ALL, US, China, HK, or A-shares
            only). The universe of actionable names narrows accordingly.
          </li>
          <li>
            Set <strong>capital</strong> (the dollar base) and{" "}
            <strong>Top-N</strong> (default 30 — the number of positions to
            keep in the final book; the rest are trimmed).
          </li>
          <li>
            Click <strong>Build Recipe Portfolio</strong>. First run takes
            5–15 seconds depending on how many names need fresh 2-year price
            history. Subsequent runs against the same market are faster — the
            button will change to <strong>Re-run (diff)</strong> and the
            allocation will diff against your last result.
          </li>
        </ol>
      </Section>

      <Section id="tiers" title="3. The three active tiers">
        <p>
          Every position ends up in one of three active tiers, plus{" "}
          <TierBadge tier="trim" /> for positions too small to hold.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <Card title="Anchor · signature dish" accent="#2563eb">
            <p>
              <strong>Weight ≥ 5.5 %</strong> <em>and</em>{" "}
              <strong>TE ≥ median TE of held book.</strong>
            </p>
            <p>
              The handful of positions that both take up real counter space{" "}
              <em>and</em> lead the rest of the book. When an anchor breaks,
              that is a book-level signal, not a single-name event.
            </p>
            <p>Typical count: 1–5 in a 30-name book.</p>
          </Card>
          <Card title="Follower · reliable staple" accent="#059669">
            <p>
              <strong>Weight ≥ 3.0 %</strong>. Leader score is not required.
            </p>
            <p>
              Core holdings that earn their weight on Kelly math alone. They
              pay the rent; they do not set the tempo. Sector caps usually
              bind at this tier before any single position hits the per-name
              cap.
            </p>
            <p>Typical count: 10–15.</p>
          </Card>
          <Card title="Tactical · daily special" accent="#d97706">
            <p>
              <strong>Weight ≥ 1.0 % and &lt; 3.0 %.</strong>
            </p>
            <p>
              Smaller positive-edge positions where the posterior is wide, the
              payoff thin, or the cap stack already binds above them. Enter at
              half-target on day 1; top up only if next week&apos;s run still
              flags them.
            </p>
            <p>Typical count: 5–10.</p>
          </Card>
        </div>

        <div
          className="rounded-lg p-3 mt-4"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
            Trim · below 1 %
          </div>
          <p className="text-xs text-zinc-400">
            Three common reasons: posterior μ is weak or negative; another
            holding already carries the same exposure more efficiently; the
            sector or correlation-cluster cap is binding. Do not hold — a
            sub-1 % position is operationally indistinguishable from noise.
          </p>
        </div>
      </Section>

      <Section id="numbers" title="4. The three key numbers in each row">
        <div className="space-y-4">
          <Card title="μ prior — the research-desk view" accent="#71717a">
            <p>
              <code className="text-[11px] bg-zinc-800 px-1 rounded">
                μ_prior = (composite_score − 50) × 0.0024
              </code>
              . Score 50 is neutral; score 100 implies +12 % annualized excess;
              score 0 implies −12 %.
            </p>
            <p>
              Think of it as what you believed about this name before looking
              at a single day of price data. It is a <strong>prior</strong> —
              the starting point for Bayesian updating, not a forecast.
            </p>
          </Card>

          <Card title="μ post — Bayesian blend" accent="#2563eb">
            <p>
              <code className="text-[11px] bg-zinc-800 px-1 rounded">
                μ_post = (μ_prior × 500 + observed_μ × n_days) / (500 + n_days)
              </code>
              . With n_days ≈ 518 for a 2-year sample, this is roughly a 50/50
              blend of prior and observed.
            </p>
            <p>
              <strong>
                This is the number Kelly actually sees.
              </strong>{" "}
              The unconstrained weight is{" "}
              <code className="text-[11px] bg-zinc-800 px-1 rounded">
                w* = Σ⁻¹ μ_post
              </code>
              . Four patterns worth recognizing:
            </p>
            <ul className="list-disc list-inside pl-2 text-[12px]">
              <li>
                Prior +, post + and similar → research &amp; market agree;
                high-conviction long.
              </li>
              <li>
                Prior +, post much higher → momentum strongly ratifies the
                thesis.
              </li>
              <li>
                Prior +, post negative → market disagrees with research for{" "}
                <em>long enough</em> that the framework respects the
                disagreement; position gets trimmed.
              </li>
              <li>
                Prior ≈ 0, post strongly + → pure momentum position;
                informationally useful but fundamentally uncommitted.
              </li>
            </ul>
          </Card>

          <Card title="TE — Schreiber Transfer Entropy (nats)" accent="#d97706">
            <p>
              Directional information flow from this name&apos;s daily returns
              into the rest of the held book. Asks: <em>how much does this
              name&apos;s move today reduce my uncertainty about the rest of the
              book&apos;s move tomorrow, above and beyond what the rest&apos;s
              own history already tells me?</em>
            </p>
            <p>Typical daily-equity range is 0.003 – 0.025 nats.</p>
            <ul className="list-disc list-inside pl-2 text-[12px]">
              <li>&gt; 0.020 — strong leader</li>
              <li>0.010 – 0.020 — moderate leader</li>
              <li>0.005 – 0.010 — mild leader</li>
              <li>&lt; 0.005 — no meaningful directional flow</li>
            </ul>
            <p>
              <strong>Key property:</strong> unlike Pearson correlation, TE is{" "}
              <em>asymmetric</em>. A can lead B with B having no leading power
              over A. That asymmetry is what separates anchors from followers.
            </p>
          </Card>
        </div>

        <p className="text-[12px] text-zinc-400 mt-4">
          <strong>Decision ladder:</strong> μ prior asks &quot;does the research
          think this is worth owning?&quot; μ post asks &quot;does the market
          agree, once we listen to both?&quot; TE asks &quot;if we do own it,
          does it lead?&quot; High-confidence anchor requires a positive answer
          to all three.
        </p>
      </Section>

      <Section id="reading" title="5. Reading the allocation output">
        <div className="space-y-3">
          <p>
            The page renders four summary cards and three structured panels on
            every successful run:
          </p>
          <ul className="list-disc list-inside pl-2 space-y-1">
            <li>
              <strong>As of / Universe / Invested / Cash / TE threshold</strong>{" "}
              — snapshot cards. Cash is residual, not leftover capital; the
              framework deliberately sits on it when the posterior distribution
              does not support full deployment.
            </li>
            <li>
              <strong>Tier summary</strong> — count and total weight per tier.
              A healthy 30-name book typically shows 1–5 anchors, 10–15
              followers, 5–10 tacticals, rest trim.
            </li>
            <li>
              <strong>Sector summary</strong> — orange highlight when a sector
              approaches the 30 % cap. Holding multiple dual-class tickers of
              the same issuer (e.g. FOX / FOXA, GOOGL / GOOG) counts as one
              correlation cluster for the 20 % cluster cap.
            </li>
            <li>
              <strong>Allocation table</strong> — per-row detail with prior /
              posterior μ, TE, tier badge, lot-rounded share counts for
              execution. Tickers link to the single-name diagnostic at{" "}
              <code className="text-[11px] bg-zinc-800 px-1 rounded">
                /stock/[symbol]
              </code>
              .
            </li>
          </ul>
        </div>
      </Section>

      <Section id="alerts" title="6. Rotation panel + alert banner">
        <p>
          Every re-run diffs the new allocation against the previous one and
          reports the result at two levels of prominence.
        </p>

        <div className="space-y-3 mt-3">
          <Card title="Top-of-results alert banner" accent="#d97706">
            <p>Four severities, each with explicit copy:</p>
            <ul className="list-disc list-inside pl-2 space-y-1 text-[12px]">
              <li>
                <span style={{ color: "#16a34a" }}>●</span> <strong>CLEAR</strong>{" "}
                (green) — no adds, no retires, no drift ≥ 2 pp. Hold through
                to next weekly review.
              </li>
              <li>
                <span style={{ color: "#3b82f6" }}>●</span> <strong>NOTICE</strong>{" "}
                (blue) — adds only. Execute at tactical weight (half-target),
                reassess next week.
              </li>
              <li>
                <span style={{ color: "#d97706" }}>●</span> <strong>WARNING</strong>{" "}
                (amber) — position(s) drifted ≥ 2 pp. Rebalance highlighted
                rows at next open.
              </li>
              <li>
                <span style={{ color: "#dc2626" }}>●</span> <strong>CRITICAL</strong>{" "}
                (red) — names retired by the engine (posterior μ collapsed or
                weight fell below the 0.5 % floor). Exit at next open.
              </li>
            </ul>
            <p className="text-[11px] text-zinc-500 mt-2">
              <strong>Mode-switch auto-detection:</strong> if added + retired ≥
              8 and fewer than 2 positions genuinely drifted, the banner calls
              out &quot;likely a mode switch (market filter or top-N change),
              not true drift.&quot;
            </p>
          </Card>

          <Card title="Rotation vs previous run" accent="#d97706">
            <p>Itemized three-section diff below the banner:</p>
            <ul className="list-disc list-inside pl-2 space-y-1 text-[12px]">
              <li>
                <strong>Added</strong> — new names entering the top-N.
              </li>
              <li>
                <strong>Retired</strong> — names dropping out, with the reason
                (posterior collapse, 60-day return threshold, weight floor).
              </li>
              <li>
                <strong>Resized</strong> — bold rows (|Δ| ≥ 2 pp) are
                actionable this week; dimmed rows (1–2 pp) are monitor-only.
              </li>
            </ul>
          </Card>
        </div>
      </Section>

      <Section id="cadence" title="7. Update frequency">
        <p>
          The framework runs on three nested cadences, each doing a different
          kind of work. Wrong cadence and the math breaks: too often burns
          edge on execution cost and noise; too rarely lets the posterior
          drift out of sync with reality.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <Card title="Daily · mise en place" accent="#71717a">
            <p>
              <strong>Automated.</strong> Cron runs at 09:00 Beijing,
              refreshes prices, re-computes posteriors, diffs against
              yesterday, prints a rebalance alert only if drift ≥ 2 pp or
              entries/exits occur.
            </p>
            <p>
              <strong>Your job:</strong> nothing on no-alert days. On alert
              days, read the diff but <em>wait until Sunday</em> unless it is
              a risk event (see § 8).
            </p>
          </Card>
          <Card title="Weekly · service review" accent="#059669">
            <p>
              <strong>Sunday evening, 30 min.</strong>
            </p>
            <ul className="list-disc list-inside pl-1 text-[12px]">
              <li>Re-run with the same market filter.</li>
              <li>
                Act on entries / exits; rebalance positions whose drift
                exceeds 25 % of target weight.
              </li>
              <li>
                Demote anchors whose TE fell below the held-book median for
                two consecutive weeks.
              </li>
              <li>
                Execute Monday at the open. Limit orders. Single batch.
              </li>
            </ul>
          </Card>
          <Card title="Quarterly · menu redesign" accent="#2563eb">
            <p>
              <strong>Every 3 months, 2 hours.</strong>
            </p>
            <ul className="list-disc list-inside pl-1 text-[12px]">
              <li>
                Cut names that failed to earn weight for 3 consecutive weekly
                runs.
              </li>
              <li>
                Promote 2–3 fresh candidates from newly actionable watchlist
                rows.
              </li>
              <li>
                Revisit caps (per-name, sector, cluster, quarter-Kelly
                fraction) — change at most one per quarter.
              </li>
            </ul>
          </Card>
        </div>

        <p className="text-[12px] text-zinc-400 mt-4">
          <strong>Total active time:</strong> roughly 45 minutes per week
          including quarterly amortization. Everything else is the cron and
          the math.
        </p>
      </Section>

      <Section id="exceptions" title="8. When to override the cadence">
        <p>
          Three cases where the framework says{" "}
          <em>act today, do not wait for Sunday.</em>
        </p>

        <div className="space-y-3 mt-3">
          <Card title="Aggregate anchor TE flip" accent="#dc2626">
            <p>
              If two or more anchors show TE dropping below threshold in the
              same week, the book-level correlation structure is breaking.{" "}
              <strong>Reduce gross exposure by 30 %</strong>, pro-rata across
              all positions, at the next open. Diagnose after.
            </p>
          </Card>
          <Card title="Per-name posterior collapse" accent="#dc2626">
            <p>
              If any held name&apos;s μ posterior flips from positive to{" "}
              &lt; −10 % in a single daily update, something discrete
              happened. Exit at next open without waiting for confirmation in
              the weekly review.
            </p>
          </Card>
          <Card title="Cap breach by drift" accent="#d97706">
            <p>
              If price action alone (no trades) pushes a single position above
              8 % of AUM, rebalance within 48 hours regardless of day of week.
              Drift <em>into</em> the cap is fine; sitting{" "}
              <em>above</em> it is an unforced risk-budget violation.
            </p>
          </Card>
        </div>
      </Section>

      <Section id="faq" title="9. FAQ and common pitfalls">
        <div className="space-y-4">
          <div>
            <div className="font-semibold text-zinc-200 mb-1">
              Why is cash so high (30 %+)?
            </div>
            <p className="text-[12px] text-zinc-400">
              The quarter-Kelly + long-only projection correctly says
              &quot;don&apos;t deploy capital for the sake of deploying
              it&quot; when the actionable universe has too many
              weak-posterior names. Expected in regimes with broad
              trailing-negative excess returns. Park the residual in
              short-dated T-bills or an MMF — that is the empty counter space
              the kitchen keeps clean because something unexpected always
              needs to be plated.
            </p>
          </div>
          <div>
            <div className="font-semibold text-zinc-200 mb-1">
              Why did a high-score name get trimmed to 0 %?
            </div>
            <p className="text-[12px] text-zinc-400">
              Three possible reasons: (a) the 2-year observed return was weak
              enough to drag the posterior negative despite a strong prior;
              (b) the covariance matrix saw another holding already carrying
              the same exposure; (c) the sector or correlation-cluster cap is
              binding and the incremental weight got pro-rated to near zero.
              All three are the framework working as intended.
            </p>
          </div>
          <div>
            <div className="font-semibold text-zinc-200 mb-1">
              My book shows no anchors. Should I worry?
            </div>
            <p className="text-[12px] text-zinc-400">
              Not necessarily. Anchor tier requires both weight ≥ 5.5 %{" "}
              <em>and</em> TE above the held-book median. If the universe is
              small (e.g. a narrow market filter), the cap stack may prevent
              any single position from reaching 5.5 %. Widen the market filter
              or increase Top-N to give the engine more room.
            </p>
          </div>
          <div>
            <div className="font-semibold text-zinc-200 mb-1">
              Can I use full-Kelly instead of quarter-Kelly?
            </div>
            <p className="text-[12px] text-zinc-400">
              No. Full-Kelly assumes μ and Σ are known without error. In an
              equity book those estimates carry enough noise that full-Kelly
              blows up on a single quarter where the realized parameters
              differ from the estimates. Every serious practitioner runs
              fractional Kelly; quarter-Kelly is the honest default for retail
              parameter uncertainty. The constant lives at the top of{" "}
              <code className="text-[11px] bg-zinc-800 px-1 rounded">
                scripts/portfolio_allocation.py
              </code>{" "}
              and{" "}
              <code className="text-[11px] bg-zinc-800 px-1 rounded">
                lib/recipe-portfolio.ts
              </code>{" "}
              if you really want to tune it.
            </p>
          </div>
          <div>
            <div className="font-semibold text-zinc-200 mb-1">
              The U.S.-only run is very different from the ALL-markets run.
              Which one should I trust?
            </div>
            <p className="text-[12px] text-zinc-400">
              They answer different questions. ALL builds the best
              risk-adjusted book across every market you monitor; U.S.-only
              builds the best book under the constraint that you only want
              U.S. exposure. The covariance matrix changes across universes,
              so the vector Kelly solution necessarily changes too. Pick the
              universe that matches your mandate and stick with it — mixing
              mandates is what triggers the mode-switch false-positive on the
              alert banner.
            </p>
          </div>
        </div>
      </Section>

      <footer className="mt-16 pt-6 border-t border-zinc-800 text-[11px] text-zinc-500">
        <p>
          The underlying framework writeup lives at{" "}
          <code className="text-[11px] bg-zinc-800 px-1 rounded">
            ~/obsidian-research/research/recipe-portfolio-30-stock-source-en.md
          </code>{" "}
          with supporting worked example and reusable prompt template in the
          same folder. Engine source:{" "}
          <code className="text-[11px] bg-zinc-800 px-1 rounded">
            lib/recipe-portfolio.ts
          </code>{" "}
          (web) and{" "}
          <code className="text-[11px] bg-zinc-800 px-1 rounded">
            scripts/portfolio_allocation.py
          </code>{" "}
          (cron).
        </p>
      </footer>
    </main>
  );
}
