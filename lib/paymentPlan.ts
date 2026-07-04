export type PaymentPart = {
  due_day: number;
  amount: number;
};

export function localTodayIso() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function currentMonthIso() {
  return localTodayIso().slice(0, 7);
}

export function daysInPaymentMonth(month: string) {
  const [y, m] = String(month || '').split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 31;
  return new Date(y, m, 0).getDate();
}

export function actualPaymentDueDate(month: string, dueDay: number) {
  const [y, m] = String(month || '').split('-').map(Number);
  const d = Math.min(Math.max(Number(dueDay || 1), 1), daysInPaymentMonth(month));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function validatePaymentPlanInput(params: {
  month?: string | null;
  parts: unknown;
  monthlyAmount: number;
}) {
  const month = params.month || currentMonthIso();
  const parts = params.parts;
  const monthlyAmount = Number(params.monthlyAmount || 0);
  const today = localTodayIso();

  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('month must be YYYY-MM');
  }
  if (month < currentMonthIso()) {
    throw new Error('Нельзя создать план оплаты за прошлый месяц');
  }
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('parts is required');
  }
  if (monthlyAmount <= 0) {
    throw new Error('monthly_amount must be greater than 0');
  }

  const usedDates = new Set<string>();
  let sum = 0;
  parts.forEach((raw, idx) => {
    const part = raw as Partial<PaymentPart>;
    const dueDay = Number(part.due_day);
    const amount = Number(part.amount || 0);

    if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) {
      throw new Error(`Часть #${idx + 1}: день месяца должен быть от 1 до 31`);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Часть #${idx + 1}: сумма должна быть больше 0`);
    }

    const dueDate = actualPaymentDueDate(month, dueDay);
    if (dueDate < today) {
      throw new Error(`Часть #${idx + 1}: дата ${dueDate} уже прошла`);
    }
    if (usedDates.has(dueDate)) {
      throw new Error(`Дата ${dueDate} повторяется. Для нескольких платежей даты должны отличаться`);
    }
    usedDates.add(dueDate);
    sum += amount;
  });

  if (sum < monthlyAmount) {
    throw new Error(`Сумма частей меньше месячной суммы: ${sum} / ${monthlyAmount}`);
  }
}
