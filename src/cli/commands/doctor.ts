import { formatCheck } from "../doctor/check.ts";
import { surveyConfigs } from "../doctor/configs.ts";
import { authCheck, bunCheck, ghCheck } from "../doctor/environment.ts";
import { channelCheck, daemonCheck, forwardingChecks } from "../doctor/runtime.ts";
import type { Invocation } from "./types.ts";

export async function runDoctor({ paths }: Invocation) {
  const environment = [bunCheck(), await ghCheck(), await authCheck()];
  const configs = await surveyConfigs(paths);
  const forwarding = await forwardingChecks(configs.sources, configs.repos);
  const checks = [
    ...environment,
    ...configs.checks,
    ...forwarding,
    await daemonCheck(paths),
    channelCheck(),
  ];
  for (const check of checks) process.stdout.write(formatCheck(check));
  if (checks.some((check) => check.level === "fail")) process.exitCode = 1;
}
