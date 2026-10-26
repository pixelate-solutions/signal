import { describe, expect, it } from "vitest";

import { isNearThreadEnd, shouldFollowNewThreadEvents } from "./thread-scroll";

describe("thread scroll anchoring", () => {
  it("does not follow background events while the user is reading earlier items", () => {
    expect(
      shouldFollowNewThreadEvents({
        previousEventCount: 12,
        nextEventCount: 13,
        wasNearEnd: false,
      }),
    ).toBe(false);
  });

  it("follows appended events when the user is already near the end", () => {
    expect(
      isNearThreadEnd({ contentOffsetY: 1_420, viewportHeight: 600, contentHeight: 2_080 }),
    ).toBe(true);
    expect(
      shouldFollowNewThreadEvents({
        previousEventCount: 12,
        nextEventCount: 13,
        wasNearEnd: true,
      }),
    ).toBe(true);
  });

  it("does not move for a same-size background refresh", () => {
    expect(
      shouldFollowNewThreadEvents({
        previousEventCount: 13,
        nextEventCount: 13,
        wasNearEnd: true,
      }),
    ).toBe(false);
  });
});
