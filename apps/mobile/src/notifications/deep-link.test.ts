import { describe, expect, it } from "vitest";

import { deepLinkSegments } from "./deep-link";

describe("deepLinkSegments", () => {
  it("keeps a path-based universal link route", () => {
    expect(deepLinkSegments("signal.pixelate.solutions", "tasks/tsk_123/actions/act_456")).toEqual([
      "tasks",
      "tsk_123",
      "actions",
      "act_456",
    ]);
  });

  it("restores the route root carried in a custom-scheme hostname", () => {
    expect(deepLinkSegments("tasks", "tsk_123/actions/act_456")).toEqual([
      "tasks",
      "tsk_123",
      "actions",
      "act_456",
    ]);
  });

  it("does not treat an arbitrary web hostname as an app route", () => {
    expect(deepLinkSegments("example.com", "tasks/tsk_123")).toEqual(["tasks", "tsk_123"]);
  });
});
