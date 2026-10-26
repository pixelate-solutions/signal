export const THREAD_END_THRESHOLD = 96;

export function isNearThreadEnd(input: {
  contentOffsetY: number;
  contentHeight: number;
  viewportHeight: number;
}): boolean {
  return (
    input.contentHeight - (input.contentOffsetY + input.viewportHeight) <= THREAD_END_THRESHOLD
  );
}

export function shouldFollowNewThreadEvents(input: {
  previousEventCount: number;
  nextEventCount: number;
  wasNearEnd: boolean;
}): boolean {
  return input.nextEventCount > input.previousEventCount && input.wasNearEnd;
}
