"use client";

const KEY = "aligator:test-role:v27";

export type ClientTestRole = "worker" | null;

export function getRoleTest(): ClientTestRole {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(KEY) === "worker" ? "worker" : null;
  } catch {
    return null;
  }
}

export function setRoleTest(role: ClientTestRole): void {
  if (typeof window === "undefined") return;
  try {
    if (role === "worker") window.sessionStorage.setItem(KEY, "worker");
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Safe fallback: no role override is persisted.
  }
}

export function roleTestHeaders(): Record<string, string> {
  return getRoleTest() === "worker" ? { "x-test-role": "worker" } : {};
}
