import { NextResponse } from 'next/server';

export function ok(data: unknown = null, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const anyError = error as any;
    const parts = [anyError.message, anyError.details, anyError.hint, anyError.code]
      .filter(Boolean)
      .map(String);
    if (parts.length) return parts.join(' | ');
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}

export function fail(error: unknown, status = 400) {
  const message = errorToMessage(error);
  const normalized = message === 'Admin only' ? 403 : status;
  return NextResponse.json({ ok: false, error: message }, { status: normalized });
}

export function requiredNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
  return n;
}

export function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function requiredString(value: unknown, field: string): string {
  const s = String(value ?? '').trim();
  if (!s) throw new Error(`${field} is required`);
  return s;
}

export function optionalString(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s ? s : null;
}

export function parseJsonBodySizeSafe(raw: unknown): unknown {
  return raw;
}
