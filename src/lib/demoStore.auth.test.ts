import { beforeEach, describe, expect, it } from "vitest";
import { demoStore } from "./demoStore";

function persistedDemoValues() {
  return Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index);
    return key ? (localStorage.getItem(key) ?? "") : "";
  }).join("~n");
}

describe("demoStore credential handling", () => {
  beforeEach(() => {
    localStorage.clear();
    demoStore.reset();
  });

  it("keeps seeded demo credentials usable without serializing passwords", () => {
    expect(demoStore.login("admin@brinely.info", "admin123").role).toBe(
      "admin",
    );

    expect(persistedDemoValues()).not.toContain("admin123");
  });

  it("keeps a newly entered demo password only in memory", () => {
    const testPassphrase = "not-for-storage";
    demoStore.registerMember({
      email: "new-player@example.com",
      password: testPassphrase,
      full_name: "New Player",
    });

    expect(
      demoStore.login("new-player@example.com", testPassphrase).role,
    ).toBe("member");
    expect(persistedDemoValues()).not.toContain(testPassphrase);
    expect(persistedDemoValues()).not.toContain('"passwords"');
  });
});
