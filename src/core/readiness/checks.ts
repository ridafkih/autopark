import type { Config } from "../../config/schema.ts";
import type { CheckContext, Evaluation, FailedCheck } from "../types.ts";

type ChecksConfig = Config["checks"];
type ChecksEvaluation = Evaluation["checks"];
type RunsByName = Map<string, CheckContext[]>;

const worstRun = (runs: CheckContext[]) =>
  runs.find((run) => run.outcome === "pending") ??
  runs.find((run) => run.outcome === "fail") ??
  runs.at(-1);

const isPending = (runs: CheckContext[] | undefined) =>
  runs === undefined || worstRun(runs)?.outcome === "pending";

function requiredNames(config: ChecksConfig, runsByName: RunsByName) {
  const gates = new Set(config.humanGates);
  const ignored = new Set(config.ignore);
  const configured = config.required.filter((name) => !gates.has(name) && !ignored.has(name));
  const markedByGitHub = config.useGitHubRequired
    ? [...runsByName]
        .filter(([name, runs]) => !gates.has(name) && runs.some((run) => run.isRequired))
        .map(([name]) => name)
    : [];
  const required = new Set([...configured, ...markedByGitHub]);
  if (required.size > 0) return required;
  return new Set([...runsByName.keys()].filter((name) => !gates.has(name)));
}

function failedChecks(runsByName: RunsByName, required: Set<string>, gates: Set<string>) {
  return [...runsByName]
    .filter(([name]) => !gates.has(name))
    .flatMap(([name, runs]): FailedCheck[] => {
      const worst = worstRun(runs);
      if (worst?.outcome !== "fail") return [];
      return [{ name, conclusion: worst.conclusion, required: required.has(name), url: worst.url }];
    });
}

function gateStates(config: ChecksConfig, runsByName: RunsByName): ChecksEvaluation["gates"] {
  return config.humanGates.map((name) => {
    const worst = worstRun(runsByName.get(name) ?? []);
    if (!worst) return { name, outcome: "missing", conclusion: "MISSING" };
    return { name, outcome: worst.outcome, conclusion: worst.conclusion };
  });
}

export function evaluateChecks(checks: CheckContext[], config: ChecksConfig): ChecksEvaluation {
  const ignored = new Set(config.ignore);
  const runsByName: RunsByName = Map.groupBy(
    checks.filter((check) => !ignored.has(check.name)),
    (check) => check.name,
  );
  const required = requiredNames(config, runsByName);
  const failed = failedChecks(runsByName, required, new Set(config.humanGates));
  const pendingRequired = [...required].filter((name) => isPending(runsByName.get(name)));
  const isRequiredGreen = !failed.some((check) => check.required) && pendingRequired.length === 0;
  return {
    failed,
    pendingRequired,
    gates: gateStates(config, runsByName),
    requiredGreen: isRequiredGreen,
  };
}
