const NUDGE_TEMPLATE = `
# Re-announce a stuck PR to the driving session until it is ready, merged or held.
nudge:
  after: 10m
  every: 10m
  escalateAfter: 30m
`;

export function initTemplate(repo: string) {
  return `# autopark config. See the "Config reference" section of the autopark README; "autopark schema" prints the JSON Schema.
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
#    command: 'osascript -e "display notification \\"$AUTOPARK_REASON\\" with title \\"#$AUTOPARK_NUMBER $AUTOPARK_KIND\\""'
#    on: [ready, conflicted, checks_failed]

autoMerge:
  default: false
  labels: []
  method: squash

reviewRequest:
  command: null
  instruction: null
${NUDGE_TEMPLATE}`;
}
