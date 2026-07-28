import {
  runStageWorker as runBaseStageWorker,
  type StageWorkerOptions,
} from "./queue_worker.ts";

export type VersionedStageWorkerOptions = StageWorkerOptions & {
  consumerVersion: string;
};

// Consumer-version validation is performed by the authenticated, bounded body
// parser in the base worker. Never clone and parse an unauthenticated request.
export function runStageWorker(
  req: Request,
  options: VersionedStageWorkerOptions,
): Promise<Response> {
  return runBaseStageWorker(req, options);
}
