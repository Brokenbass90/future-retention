import path from "node:path";
import os from "node:os";
import { cp, mkdtemp, rm } from "node:fs/promises";

/**
 * composeEmailFromBlocks removes its destination before scaffolding it. When a
 * reopened mail is also used as its own skeleton, stage a private snapshot so
 * that destructive replacement never erases the source before it is copied.
 */
export async function stageComposeSkeletonIfDestination(skeleton, destination) {
  if (!skeleton || !destination || path.resolve(skeleton) !== path.resolve(destination)) {
    return { skeleton, staged: false, cleanup: async () => {} };
  }
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "retkit-compose-skeleton-"));
  const stagedSkeleton = path.join(tempRoot, "mail");
  try {
    await cp(skeleton, stagedSkeleton, {
      recursive: true,
      filter: (source) => path.basename(source) !== "dist",
    });
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  let cleaned = false;
  return {
    skeleton: stagedSkeleton,
    staged: true,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}
