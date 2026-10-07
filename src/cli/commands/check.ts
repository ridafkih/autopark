import { parseArgs } from "node:util";
import { fetchEvaluation } from "../evaluation.ts";
import { print } from "../output.ts";
import { projectContext, resolveRef } from "../project.ts";
import { formatCheckReport } from "./check-report.ts";
import type { Invocation } from "./types.ts";

export async function checkPullRequest({ argv, paths }: Invocation) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { json: { type: "boolean" } },
  });
  const { config } = await projectContext();
  const ref = await resolveRef(positionals[0], config);
  const { evaluation, cost, reads } = await fetchEvaluation(ref, paths);
  print(
    values.json
      ? JSON.stringify(evaluation, null, 2)
      : formatCheckReport(evaluation, { cost, reads }),
  );
}
