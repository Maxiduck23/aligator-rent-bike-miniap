export type BatterySlot =
  | { mode: 'existing'; battery_id: number }
  | { mode: 'create'; type_id: number; note?: string | null }
  | { mode: 'temporary'; type_id: number; note?: string | null };

export type RentalContractInput = {
  bike_id: number;
  client_id: number;
  plan_code: string;
  start_date: string;
  batteries: BatterySlot[];
  charger_quantity: number;
  extra_battery_count: number;
  recurring_rent_override?: number | null;
  deposit_override?: number | null;
  first_period_rent_override?: number | null;
  notes?: string | null;
};

function localTodayIso() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function positiveInteger(value: unknown, field: string) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${field} должен быть целым числом больше 0`);
  return n;
}

function optionalMoney(value: unknown, field: string) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} должен быть числом от 0`);
  return n;
}

export function validateBatterySlot(value: unknown): BatterySlot {
  if (!value || typeof value !== 'object') throw new Error('Некорректный слот батареи');
  const raw = value as Record<string, unknown>;
  const mode = String(raw.mode || '');
  if (mode === 'existing') return { mode, battery_id: positiveInteger(raw.battery_id, 'battery_id') };
  if (mode === 'create' || mode === 'temporary') {
    return { mode, type_id: positiveInteger(raw.type_id, 'type_id'), note: raw.note ? String(raw.note).trim() : null };
  }
  throw new Error('Режим батареи должен быть existing, create или temporary');
}

export function validateRentalContractInput(value: unknown): RentalContractInput {
  if (!value || typeof value !== 'object') throw new Error('Тело запроса обязательно');
  const raw = value as Record<string, any>;
  const planCode = String(raw.plan_code || '').trim();
  if (!planCode) throw new Error('plan_code обязателен');
  const startDate = String(raw.start_date || localTodayIso());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('start_date должен быть YYYY-MM-DD');
  if (!Array.isArray(raw.batteries)) throw new Error('batteries должен быть массивом');
  if (raw.batteries.length > 10) throw new Error('Нельзя выдать больше 10 батарей одним договором');
  const extraBatteryCount = Number(raw.extra_battery_count || 0);
  if (!Number.isInteger(extraBatteryCount) || extraBatteryCount < 0) throw new Error('extra_battery_count должен быть целым числом от 0');
  const chargerQuantity = Number(raw.charger_quantity ?? 1);
  if (!Number.isInteger(chargerQuantity) || chargerQuantity < 0 || chargerQuantity > 10) throw new Error('charger_quantity должен быть целым числом от 0 до 10');

  return {
    bike_id: positiveInteger(raw.bike_id, 'bike_id'),
    client_id: positiveInteger(raw.client_id, 'client_id'),
    plan_code: planCode,
    start_date: startDate,
    batteries: raw.batteries.map(validateBatterySlot),
    charger_quantity: chargerQuantity,
    extra_battery_count: extraBatteryCount,
    recurring_rent_override: optionalMoney(raw.recurring_rent_override, 'recurring_rent_override'),
    deposit_override: optionalMoney(raw.deposit_override, 'deposit_override'),
    first_period_rent_override: optionalMoney(raw.first_period_rent_override, 'first_period_rent_override'),
    notes: raw.notes ? String(raw.notes).trim() : null,
  };
}
