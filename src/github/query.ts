const GITHUB_ACTIONS_APP_ID = 15368;

export const PULL_REQUEST_SNAPSHOT_QUERY = `query PullRequestSnapshot($owner: String!, $name: String!, $number: Int!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    pullRequest(number: $number) {
      number title url state isDraft headRefName baseRefName headRefOid
      author { login }
      labels(first: 50) { nodes { name } }
      mergeable mergeStateStatus reviewDecision
      latestOpinionatedReviews(first: 50, writersOnly: true) { nodes { author { __typename login } state commit { oid } } }
      reviewThreads(first: 100) { nodes { id isResolved isOutdated path comments(first: 1) { nodes { author { login } url } } } }
      firstComments: comments(first: 25) { nodes { id author { login } body updatedAt } }
      lastComments: comments(last: 25) { nodes { id author { login } body updatedAt } }
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 100) { nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl startedAt isRequired(pullRequestNumber: $number) checkSuite { app { slug } workflowRun { event workflow { name } } } }
        ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: $number) }
      } } }
      checkSuites(first: 30, filterBy: { appId: ${GITHUB_ACTIONS_APP_ID} }) { nodes { app { slug } workflowRun { event workflow { name } } checkRuns(first: 60, filterBy: { checkType: LATEST }) { nodes {
        name status conclusion detailsUrl startedAt isRequired(pullRequestNumber: $number)
      } } } } } } }
    }
  }
}`;

export const SEARCH_QUERY = `query SearchPullRequests($query: String!, $after: String) {
  search(query: $query, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { number headRefName baseRefName author { login } labels(first: 50) { nodes { name } } repository { nameWithOwner } } }
  }
}`;

export const VIEWER_QUERY = `query { viewer { login } }`;
