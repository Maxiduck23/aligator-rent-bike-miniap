"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  bike: any;
  active: any;
  showToast: (text: string) => void;
  reload: () => Promise<void>;
};

type PlanStep = {
  id: number;
  step_number: number;
  offset_days: number;
  amount: number;
  charge_type: "rent" | "deposit";
  label: string;
};

type Plan = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  first_period_rent: number;
  recurring_rent: number;
  deposit_amount: number;
  included_batteries: number;
  included_chargers: number;
  minimum_months: number;
  extra_battery_monthly_fee: number;
  rental_plan_steps?: PlanStep[];
};

type Client = {
  id: number;
  name: string;
};

type BatteryType = {
  id: number;
  brand?: string | null;
  capacity?: string | null;
  generation?: string | null;
};

type Battery = {
  id: number;
  inventory_code?: string | null;
  indexing_status?: string | null;
  status?: string | null;
  type_id: number;
  brand?: string | null;
  capacity?: string | null;
  generation?: string | null;
};

type BatteryMode = "existing" | "create" | "temporary";

type BatterySlot = {
  mode: BatteryMode;
  battery_id?: number;
  type_id?: number;
  note?: string;
};

type OptionsPayload = {
  clients: Client[];
  battery_types: BatteryType[];
  available_batteries: Battery[];
};

function tgInitData() {
  if (typeof window === "undefined") return "";
  return (window as any).Telegram?.WebApp?.initData || "";
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-telegram-init-data": tgInitData(),
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !json.ok) {
    const error = json?.error;
    const message =
      typeof error === "string"
        ? error
        : [error?.message, error?.details, error?.hint, error?.code].filter(Boolean).join(" | ") ||
          "API error";
    throw new Error(message);
  }
  return json.data as T;
}

function localToday() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(date: string, months: number) {
  const d = new Date(`${date}T12:00:00`);
  const originalDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const max = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, max));
  return d.toISOString().slice(0, 10);
}

function money(value: unknown) {
  return `${Math.round(Number(value || 0))} Kč`;
}

function batteryLabel(b: Battery) {
  const code = b.inventory_code || `BAT DB#${b.id}`;
  const details = [b.brand, b.capacity, b.generation].filter(Boolean).join(" ");
  const temp = b.indexing_status === "temporary" ? " · временная" : "";
  return `${code}${details ? ` · ${details}` : ""}${temp}`;
}

function typeLabel(t: BatteryType) {
  return [t.brand || `Тип #${t.id}`, t.capacity, t.generation].filter(Boolean).join(" · ");
}

function defaultSlot(options: OptionsPayload): BatterySlot {
  const firstExisting = options.available_batteries[0];
  const firstType = options.battery_types[0];
  if (firstExisting) return { mode: "existing", battery_id: firstExisting.id };
  return { mode: "temporary", type_id: firstType?.id };
}

export default function RentalContractForm({ bike, active, showToast, reload }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [options, setOptions] = useState<OptionsPayload>({
    clients: [],
    battery_types: [],
    available_batteries: [],
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [clientId, setClientId] = useState("");
  const [planCode, setPlanCode] = useState("monthly_2_batteries");
  const [startDate, setStartDate] = useState(localToday());
  const [extraCount, setExtraCount] = useState(0);
  const [chargerQuantity, setChargerQuantity] = useState(2);
  const [slots, setSlots] = useState<BatterySlot[]>([]);
  const [initialPayment, setInitialPayment] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [closeStatus, setCloseStatus] = useState("free");

  const [extraSlot, setExtraSlot] = useState<BatterySlot>({
    mode: "temporary",
  });
  const [extraChargeNow, setExtraChargeNow] = useState(true);

  const selectedPlan = plans.find((p) => p.code === planCode) || plans[0] || null;
  const requiredBatteries = selectedPlan
    ? Number(selectedPlan.included_batteries || 0) + Number(extraCount || 0)
    : 0;

  const firstDueNow = useMemo(() => {
    if (!selectedPlan) return 0;
    const stepNow = (selectedPlan.rental_plan_steps || [])
      .filter((s) => Number(s.offset_days) === 0)
      .reduce((sum, s) => sum + Number(s.amount || 0), 0);
    return stepNow + extraCount * Number(selectedPlan.extra_battery_monthly_fee || 0);
  }, [selectedPlan, extraCount]);

  const recurringTotal = selectedPlan
    ? Number(selectedPlan.recurring_rent || 0) +
      extraCount * Number(selectedPlan.extra_battery_monthly_fee || 0)
    : 0;

  async function load() {
    setLoading(true);
    try {
      const [planRows, optionRows] = await Promise.all([
        request<Plan[]>("/api/admin/rental-contracts"),
        request<OptionsPayload>(
          `/api/admin/rental-contracts/options?bike_id=${encodeURIComponent(bike.id)}`,
        ),
      ]);
      setPlans(planRows);
      setOptions(optionRows);

      const defaultPlan =
        planRows.find((p) => p.code === planCode) ||
        planRows.find((p) => p.code === "monthly_2_batteries") ||
        planRows[0];

      if (defaultPlan) {
        setPlanCode(defaultPlan.code);
        setChargerQuantity(Number(defaultPlan.included_chargers || 1));
        const count = Number(defaultPlan.included_batteries || 0);
        setSlots(Array.from({ length: count }, () => defaultSlot(optionRows)));
        const dueNow =
          (defaultPlan.rental_plan_steps || [])
            .filter((s) => Number(s.offset_days) === 0)
            .reduce((sum, s) => sum + Number(s.amount || 0), 0);
        setInitialPayment(dueNow);
      }

      if (optionRows.battery_types[0]) {
        setExtraSlot({ mode: "temporary", type_id: optionRows.battery_types[0].id });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((e) => showToast(e.message));
  }, [bike.id]);

  useEffect(() => {
    if (!selectedPlan) return;
    setChargerQuantity(Number(selectedPlan.included_chargers || 1));
    setSlots((current) => {
      const next = [...current];
      while (next.length < requiredBatteries) next.push(defaultSlot(options));
      return next.slice(0, requiredBatteries);
    });
    setInitialPayment(firstDueNow);
  }, [planCode, extraCount, requiredBatteries]);

  function updateSlot(index: number, patch: Partial<BatterySlot>) {
    setSlots((current) =>
      current.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    );
  }

  function validateSlots(values: BatterySlot[]) {
    if (values.length !== requiredBatteries) {
      throw new Error(`Нужно заполнить ${requiredBatteries} батарейных слотов.`);
    }
    const existingIds = values
      .filter((x) => x.mode === "existing")
      .map((x) => Number(x.battery_id));
    if (new Set(existingIds).size !== existingIds.length) {
      throw new Error("Одна существующая батарея выбрана несколько раз.");
    }
    values.forEach((slot, index) => {
      if (slot.mode === "existing" && !slot.battery_id) {
        throw new Error(`Батарея #${index + 1}: выбери существующую батарею.`);
      }
      if ((slot.mode === "create" || slot.mode === "temporary") && !slot.type_id) {
        throw new Error(`Батарея #${index + 1}: выбери тип батареи.`);
      }
    });
  }

  async function createContract() {
    if (!clientId) return showToast("Выбери клиента.");
    if (!selectedPlan) return showToast("Тарифы не загрузились.");

    try {
      validateSlots(slots);
      setBusy(true);
      const result = await request<any>("/api/admin/rental-contracts", {
        method: "POST",
        body: JSON.stringify({
          bike_id: bike.id,
          client_id: Number(clientId),
          plan_code: selectedPlan.code,
          start_date: startDate,
          batteries: slots,
          charger_quantity: Number(chargerQuantity),
          extra_battery_count: Number(extraCount),
          initial_payment: {
            amount: Number(initialPayment),
            method: paymentMethod,
          },
          notes: notes || null,
        }),
      });

      const temporaryCount = slots.filter((s) => s.mode === "temporary").length;
      showToast(
        `Договор #${result?.rental?.id || "создан"} · батарей ${slots.length}` +
          (temporaryCount ? ` · временных ${temporaryCount}` : ""),
      );
      await reload();
    } catch (e: any) {
      showToast(e.message || "Не удалось создать договор");
    } finally {
      setBusy(false);
    }
  }

  async function closeContract() {
    if (!active) return;
    const oldDeposit = Number(active.deposit || 0);
    const raw = prompt(
      `Сколько депозита вернули клиенту?\nДепозит договора: ${money(oldDeposit)}`,
      "0",
    );
    if (raw === null) return;
    const refund = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(refund) || refund < 0) {
      return showToast("Некорректная сумма возврата.");
    }
    if (!confirm(`Закрыть договор велика #${bike.id}?`)) return;

    try {
      setBusy(true);
      await request("/api/admin/rentals/close", {
        method: "POST",
        body: JSON.stringify({
          bike_id: bike.id,
          end_date: localToday(),
          bike_status: closeStatus,
          deposit_refund: refund,
          notes: "closed from tariff contract UI",
        }),
      });
      showToast(refund ? `Договор закрыт, возвращено ${money(refund)}` : "Договор закрыт");
      await reload();
    } catch (e: any) {
      showToast(e.message || "Не удалось закрыть договор");
    } finally {
      setBusy(false);
    }
  }

  async function addExtraBattery() {
    try {
      if ((extraSlot.mode === "create" || extraSlot.mode === "temporary") && !extraSlot.type_id) {
        return showToast("Выбери тип батареи.");
      }
      if (extraSlot.mode === "existing" && !extraSlot.battery_id) {
        return showToast("Выбери существующую батарею.");
      }
      setBusy(true);
      await request("/api/admin/rental-contracts/add-battery", {
        method: "POST",
        body: JSON.stringify({
          rental_id: active.id,
          battery: extraSlot,
          effective_date: localToday(),
          charge_now: extraChargeNow,
        }),
      });
      showToast(
        extraChargeNow
          ? "Дополнительная батарея выдана, начисление создано"
          : "Дополнительная батарея выдана, доплата начнётся со следующего периода",
      );
      await reload();
      await load();
    } catch (e: any) {
      showToast(e.message || "Не удалось добавить батарею");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="card">Загрузка тарифов и батарей...</div>;
  }

  if (active) {
    const snapshot = active.contract_terms_snapshot || {};
    const isTariff = Boolean(active.plan_code || snapshot.plan_code);

    return (
      <div className="card">
        <div className="space">
          <h3 className="section-title">📄 Активный договор</h3>
          <span className={`pill ${isTariff ? "ok" : "warn"}`}>
            {isTariff ? active.plan_name || snapshot.plan_name || "тарифный" : "старый договор"}
          </span>
        </div>

        <div className="kv">
          <div>Клиент</div>
          <div>#{active.client_id} {active.client_name || ""}</div>
          <div>Начало</div>
          <div>{active.start_date}</div>
          <div>Минимум до</div>
          <div>{active.minimum_end_date || "не задано"}</div>
          <div>Регулярная сумма</div>
          <div><b>{money(active.recurring_rent || active.price)}</b></div>
          <div>Депозит</div>
          <div>{money(active.deposit)}</div>
          <div>Батареи по договору</div>
          <div>
            {Number(active.included_batteries || 0) + Number(active.extra_batteries || 0) || "старый учёт"}
          </div>
          <div>Доп. батареи</div>
          <div>{Number(active.extra_batteries || 0)}</div>
          <div>Зарядки</div>
          <div>{active.charger_quantity || 0}</div>
        </div>

        {isTariff && (
          <>
            <hr className="hr" />
            <h4>🔋 Добавить дополнительную батарею</h4>
            <BatterySlotEditor
              slot={extraSlot}
              index={0}
              options={options}
              onChange={(patch) => setExtraSlot((x) => ({ ...x, ...patch }))}
              single
            />
            <label className="row small" style={{ marginTop: 10 }}>
              <input
                type="checkbox"
                checked={extraChargeNow}
                onChange={(e) => setExtraChargeNow(e.target.checked)}
              />
              начислить {money(1500)} сейчас за начатый период
            </label>
            <button
              className="btn primary"
              disabled={busy}
              onClick={addExtraBattery}
              style={{ marginTop: 10 }}
            >
              {busy ? "Сохраняю..." : "Выдать дополнительную батарею"}
            </button>
          </>
        )}

        <hr className="hr" />
        <div className="formgrid">
          <label>
            Статус велика после закрытия
            <select
              className="select"
              value={closeStatus}
              onChange={(e) => setCloseStatus(e.target.value)}
            >
              <option value="free">Свободен</option>
              <option value="repair">В ремонт</option>
              <option value="waiting">Ожидает проверки</option>
              <option value="sold">Продан</option>
            </select>
          </label>
        </div>
        <button className="btn danger" disabled={busy} onClick={closeContract}>
          Закрыть договор
        </button>

        {!isTariff && (
          <p className="small muted" style={{ marginTop: 10 }}>
            Это старый договор. Админское правило оплаты ниже продолжает работать.
            Чтобы перейти на новый тариф, закрой этот договор и создай новый.
          </p>
        )}
      </div>
    );
  }

  if (!selectedPlan) {
    return (
      <div className="card dangerText">
        Тарифы не найдены. Сначала выполни SQL-миграцию rental plans.
      </div>
    );
  }

  const client = options.clients.find((c) => c.id === Number(clientId));
  const steps = [...(selectedPlan.rental_plan_steps || [])].sort(
    (a, b) => a.step_number - b.step_number,
  );

  return (
    <div className="card">
      <div className="space">
        <h3 className="section-title">📄 Новый договор аренды</h3>
        <span className="pill ok">тарифный мастер</span>
      </div>

      <div className="formgrid">
        <label>
          Клиент
          <select
            className="select"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Выбери клиента</option>
            {options.clients.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.id} {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Дата начала
          <input
            className="input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
      </div>

      <h4 style={{ marginBottom: 8 }}>Тариф</h4>
      <div className="list">
        {plans.map((plan) => {
          const selected = plan.code === selectedPlan.code;
          return (
            <button
              type="button"
              key={plan.code}
              className={`item ${selected ? "active ok" : ""}`}
              onClick={() => {
                setPlanCode(plan.code);
                setExtraCount(0);
              }}
            >
              <div className="space">
                <b>{selected ? "●" : "○"} {plan.name}</b>
                <span className="money">{money(plan.first_period_rent)}</span>
              </div>
              <div className="small muted">
                {plan.description} · {plan.included_batteries} АКБ · залог {money(plan.deposit_amount)}
              </div>
              <div className="small muted">
                Со второго периода: {money(plan.recurring_rent)}
              </div>
            </button>
          );
        })}
      </div>

      <hr className="hr" />

      <div className="formgrid">
        <label>
          Дополнительные батареи
          <input
            className="input"
            type="number"
            min={0}
            max={5}
            value={extraCount}
            onChange={(e) => setExtraCount(Math.max(0, Math.min(5, Number(e.target.value) || 0)))}
          />
          <span className="small muted">
            +{money(selectedPlan.extra_battery_monthly_fee)} за каждую
          </span>
        </label>

        <label>
          Количество зарядок
          <input
            className="input"
            type="number"
            min={0}
            max={10}
            value={chargerQuantity}
            onChange={(e) => setChargerQuantity(Number(e.target.value) || 0)}
          />
        </label>
      </div>

      <h4>🔋 Батареи: {requiredBatteries}</h4>
      <p className="small muted">
        Можно выбрать существующую, создать полностью индексированную или временную
        батарею. Временная получит код TMP-BAT и не блокирует создание договора.
      </p>

      {slots.map((slot, index) => (
        <BatterySlotEditor
          key={index}
          slot={slot}
          index={index}
          options={options}
          onChange={(patch) => updateSlot(index, patch)}
        />
      ))}

      <hr className="hr" />

      <div className="formgrid">
        <label>
          Получено сейчас
          <input
            className="input"
            type="number"
            min={0}
            value={initialPayment}
            onChange={(e) => setInitialPayment(Number(e.target.value) || 0)}
          />
          <span className="small muted">По графику сегодня: {money(firstDueNow)}</span>
        </label>

        <label>
          Метод оплаты
          <select
            className="select"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            <option value="cash">Наличные</option>
            <option value="bank">Банк</option>
            <option value="card">Карта</option>
            <option value="manual">Ручной ввод</option>
          </select>
        </label>
      </div>

      <label>
        Заметка
        <textarea
          className="textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Особые условия, состояние комплекта, договорённости"
        />
      </label>

      <div className="item" style={{ marginTop: 12 }}>
        <h4 style={{ marginTop: 0 }}>Предпросмотр</h4>
        <div className="kv">
          <div>Клиент</div>
          <div>{client ? `#${client.id} ${client.name}` : "не выбран"}</div>
          <div>Велосипед</div>
          <div>#{bike.id} {bike.brand || ""} {bike.model || ""}</div>
          <div>Тариф</div>
          <div>{selectedPlan.name}</div>
          <div>Минимум до</div>
          <div>{addMonths(startDate, selectedPlan.minimum_months)}</div>
          <div>АКБ</div>
          <div>{requiredBatteries}, из них временных {slots.filter((s) => s.mode === "temporary").length}</div>
          <div>К оплате сейчас по графику</div>
          <div><b>{money(firstDueNow)}</b></div>
          <div>Фактически получено</div>
          <div>{money(initialPayment)}</div>
          <div>Регулярно со следующего периода</div>
          <div><b>{money(recurringTotal)}</b></div>
        </div>

        <h5>Первый график</h5>
        <div className="list">
          {steps.map((step) => (
            <div className="item" key={step.id}>
              <div className="space">
                <span>{addDays(startDate, step.offset_days)} · {step.label}</span>
                <b>{money(step.amount)}</b>
              </div>
            </div>
          ))}
          {extraCount > 0 && (
            <div className="item">
              <div className="space">
                <span>{startDate} · дополнительные батареи × {extraCount}</span>
                <b>{money(extraCount * selectedPlan.extra_battery_monthly_fee)}</b>
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        className="btn ok"
        disabled={busy || !clientId}
        onClick={createContract}
        style={{ marginTop: 12 }}
      >
        {busy ? "Создаю договор..." : "✅ Создать договор и начисления"}
      </button>

      <p className="small muted">
        Правило оплаты остаётся ниже только для администратора как расширенный ручной
        инструмент. Клиент больше не может менять или запрашивать его через Mini App.
      </p>
    </div>
  );
}

function BatterySlotEditor({
  slot,
  index,
  options,
  onChange,
  single = false,
}: {
  slot: BatterySlot;
  index: number;
  options: OptionsPayload;
  onChange: (patch: Partial<BatterySlot>) => void;
  single?: boolean;
}) {
  const usedMode = slot.mode || "temporary";

  return (
    <div className="item" style={{ marginBottom: 10 }}>
      <div className="space">
        <b>{single ? "Дополнительная батарея" : `Батарея ${index + 1}`}</b>
        <span className={`pill ${usedMode === "temporary" ? "warn" : "ok"}`}>
          {usedMode === "existing"
            ? "из базы"
            : usedMode === "create"
              ? "создать"
              : "временно"}
        </span>
      </div>

      <div className="formgrid">
        <label>
          Способ
          <select
            className="select"
            value={usedMode}
            onChange={(e) => {
              const mode = e.target.value as BatteryMode;
              if (mode === "existing") {
                onChange({
                  mode,
                  battery_id: options.available_batteries[0]?.id,
                  type_id: undefined,
                });
              } else {
                onChange({
                  mode,
                  battery_id: undefined,
                  type_id: options.battery_types[0]?.id,
                });
              }
            }}
          >
            <option value="existing">Выбрать существующую</option>
            <option value="create">Создать индексированную</option>
            <option value="temporary">Создать временную</option>
          </select>
        </label>

        {usedMode === "existing" ? (
          <label>
            Батарея
            <select
              className="select"
              value={slot.battery_id || ""}
              onChange={(e) => onChange({ battery_id: Number(e.target.value) })}
            >
              <option value="">Выбери батарею</option>
              {options.available_batteries.map((b) => (
                <option key={b.id} value={b.id}>
                  {batteryLabel(b)}
                </option>
              ))}
            </select>
            {!options.available_batteries.length && (
              <span className="small dangerText">
                Свободных батарей в базе нет — выбери временное создание.
              </span>
            )}
          </label>
        ) : (
          <label>
            Тип батареи
            <select
              className="select"
              value={slot.type_id || ""}
              onChange={(e) => onChange({ type_id: Number(e.target.value) })}
            >
              <option value="">Выбери тип</option>
              {options.battery_types.map((t) => (
                <option key={t.id} value={t.id}>
                  {typeLabel(t)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {usedMode !== "existing" && (
        <label>
          Короткая заметка
          <input
            className="input"
            value={slot.note || ""}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder={
              usedMode === "temporary"
                ? "например: чёрная без наклейки"
                : "например: новая батарея со склада"
            }
          />
        </label>
      )}
    </div>
  );
}
