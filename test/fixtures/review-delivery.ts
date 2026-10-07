import { pullRequestPayload, repository } from "./harness.ts";

export const reviewDelivery = (id: string, number = 7) => ({
  id,
  event: "pull_request_review",
  payload: { action: "submitted", pull_request: pullRequestPayload(number), repository },
});
