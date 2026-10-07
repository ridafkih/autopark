export function initTemplate(repo: string) {
  return `# pr-autopilot config. See the "Config reference" section of the pr-autopilot README; "pr-autopilot schema" prints the JSON Schema.
repos:
  - ${repo}

# PRs matching every non-empty filter are tracked automatically.
track:
  authors: ["@me"]
  branchPrefixes: []
  labels: []

checks:
  useGitHubRequired: true
  required: []
  humanGates: []
  ignore: []

# Reviewer bots and how to read their score. Built-in parsers: greptile, regex.
reviewers: []
#  - name: greptile
#    parser: greptile
#    minScore: 5

readiness:
  noUnresolvedThreads: true
  approvalOnHead: true
  minApprovals: 1
  noConflict: true
  baseFreshness:
    policy: "off"

notify: []
#  - type: command
#    command: 'osascript -e "display notification \\"$PR_AUTOPILOT_REASON\\" with title \\"#$PR_AUTOPILOT_NUMBER $PR_AUTOPILOT_KIND\\""'
#    on: [ready, conflicted, checks_failed]

autoMerge:
  default: false
  labels: []
  method: squash

reviewRequest:
  command: null
  instruction: null
`;
}
