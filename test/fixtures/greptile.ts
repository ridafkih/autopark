export const SHA_A = "6b45e484e77aacfd94e49ca198acb1e275784162";
export const SHA_B = "f41a9f467c7e5e326375b15e1295e536f3c79fbb";

const header = (score: number) =>
  `<h2><a href="https://app.greptile.com/api/retrigger?id=1"><picture><source media="(prefers-color-scheme: dark)" srcset="https://example.invalid/RetriggerDark.svg"><img alt="Retrigger" src="https://example.invalid/Retrigger.svg" align="right"></picture></a>Confidence Score: ${score}/5</h2>`;

const footer = (reviews: number, sha: string) =>
  `<sub>Reviews (${reviews}) · Last reviewed commit: ["tidy the widget loader"](https://github.com/acme/widgets/commit/${sha}) · [Reviewed by Greptile](https://www.greptile.com/?utm_source=greptile_expert)</sub>`;

export function greptileSummary(opts: {
  score?: number;
  visibleScore?: number | null;
  hiddenScore?: number | null;
  reviews?: number;
  sha?: string | null;
}) {
  const score = opts.score ?? 5;
  const visible = opts.visibleScore === undefined ? score : opts.visibleScore;
  const hidden = opts.hiddenScore === undefined ? score : opts.hiddenScore;
  const parts = ["<!-- greptile_summary -->", ""];
  if (visible !== null) parts.push(header(visible), "");
  parts.push(
    "**[Low risk]** Tidies how widgets load\\.",
    "",
    "<details open><summary>Summary</summary>",
    "",
    "The loader now resolves widgets lazily.",
    "- No new actionable issues were found.",
    "</details>",
    "",
  );
  if (hidden !== null) parts.push(`<!-- greptile_confidence_score:${hidden} -->`, "");
  if (opts.sha !== null) parts.push(footer(opts.reviews ?? 1, opts.sha ?? SHA_A));
  return parts.join("\n");
}
