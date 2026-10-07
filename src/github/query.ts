export const PR_SNAPSHOT_QUERY = `query PrSnapshot($owner: String!, $name: String!, $n: Int!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    pullRequest(number: $n) {
      number title url state isDraft headRefName baseRefName headRefOid
      baseRef { target { oid } }
      author { login }
      labels(first: 50) { nodes { name } }
      mergeable mergeStateStatus
      latestOpinionatedReviews(first: 50, writersOnly: true) { nodes { author { login } state commit { oid } } }
      reviewThreads(first: 100) { nodes { id isResolved isOutdated path comments(first: 1) { nodes { author { login } url } } } }
      firstComments: comments(first: 25) { nodes { id author { login } body updatedAt } }
      lastComments: comments(last: 25) { nodes { id author { login } body updatedAt } }
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 100) { nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: $n) checkSuite { app { slug } } }
        ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: $n) }
      } } } } } }
    }
  }
}`;

export const SEARCH_QUERY = `query SearchPrs($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { number headRefName baseRefName author { login } labels(first: 50) { nodes { name } } repository { nameWithOwner } } }
  }
}`;

export const VIEWER_QUERY = `query { viewer { login } }`;
