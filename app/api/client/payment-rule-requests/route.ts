import { NextResponse } from 'next/server';

function adminOnly() {
  return NextResponse.json(
    { ok: false, error: 'Правило оплаты изменяет только администратор.' },
    { status: 403 },
  );
}

export async function POST() { return adminOnly(); }
export async function PUT() { return adminOnly(); }
export async function PATCH() { return adminOnly(); }
export async function DELETE() { return adminOnly(); }
