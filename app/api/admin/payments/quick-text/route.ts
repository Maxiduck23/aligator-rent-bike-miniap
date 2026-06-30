import { NextRequest } from "next/server";
import { fail, ok, optionalString } from "@/lib/http";
import { requireAdmin } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ParsedLine = {
  line: string;
  bike_id: number;
  amount: number;
  action: "payment" | "debt";
  charge_type: string;
};

function norm(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[–—]/g, "-")
    .replace(/\u00a0/g, " ")
    .trim();
}

function parseAmount(raw: string, suffix?: string): number {
  const normalized = raw.replace(",", ".").trim();
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Некорректная сумма: ${raw}`);
  // 2к / 2k / 2.5к = 2000 / 2500. 2000к не умножаем второй раз.
  // В словах "крон/korun" суффикс не матчится этим regex, поэтому 700 крон = 700.
  if (suffix && /^(к|k)$/i.test(suffix.trim()) && n < 1000) return Math.round(n * 1000);
  return n;
}

function detectBikeId(line: string): number | null {
  const n = norm(line);
  const patterns = [
    /(?:вел(?:ик)?|bike|vel|b|байк|дуотс|duotts|игвей|engwe)\s*#?\s*(\d{1,5})/iu,
    /(\d{1,5})\s*(?:вел(?:ик)?|bike|vel|байк|дуотс|duotts|игвей|engwe)/iu,
    /#\s*(\d{1,5})/iu,
  ];
  for (const pat of patterns) {
    const m = n.match(pat);
    if (m) {
      const id = Number(m[1]);
      if (Number.isFinite(id) && id > 0) return id;
    }
  }
  return null;
}

function detectAmount(line: string): number | null {
  const amountRe = /(?<!\d)(\d+(?:[\.,]\d+)?)(?:\s*(к|k)(?=$|[\s.,;:!?)]))?/giu;
  const candidates: Array<{ amount: number; idx: number }> = [];
  for (const m of line.matchAll(amountRe)) {
    const amount = parseAmount(m[1], m[2]);
    const idx = m.index || 0;
    candidates.push({ amount, idx });
  }
  if (!candidates.length) return null;
  // Берём самую большую сумму, чтобы "вел 24 2000" не стало 24 Kč.
  candidates.sort((a, b) => b.amount - a.amount || a.idx - b.idx);
  return candidates[0].amount;
}

function isDebtLine(line: string): boolean {
  const n = norm(line);
  // В JS \b плохо работает с кириллицей, поэтому без word-boundary.
  return /(долг|долги|должен|должна|должны|торчит|торчу|dluh)/iu.test(n);
}

function detectChargeType(line: string): string {
  const n = norm(line);
  if (/(аренда|аренд|оренда|оренд|rent|pronajem|pronájem)/iu.test(n)) return "rent";
  if (/(сервис|ремонт|service|servis|oprava)/iu.test(n)) return "repair";
  if (/(штраф|fine|pokuta)/iu.test(n)) return "fine";
  if (/(депозит|залог|deposit)/iu.test(n)) return "deposit";
  return "other";
}

function parsePaymentOrDebtLines(text: string, forceAction?: "payment" | "debt", defaultChargeType = "rent"): ParsedLine[] {
  const rawLines = (text || "")
    .replace(/\u00a0/g, " ")
    .split(/\r?\n|;+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const results: ParsedLine[] = [];

  for (const line of rawLines) {
    const bikeId = detectBikeId(line);
    const amount = detectAmount(line);
    if (!bikeId || !amount) {
      throw new Error(`Не понял строку: "${line}". Примеры: "24 велик 2000 оплата", "+ 2000 долг вел 24", "+ 3000 аренда вел 24"`);
    }
    const action: "payment" | "debt" = forceAction || (isDebtLine(line) ? "debt" : "payment");
    const charge_type = action === "debt" ? (defaultChargeType && defaultChargeType !== "auto" ? defaultChargeType : detectChargeType(line)) : "rent";
    results.push({ line, bike_id: bikeId, amount, action, charge_type });
  }

  if (!results.length) throw new Error("Не найдено ни одной строки");
  return results;
}

async function findActiveRental(bikeId: number) {
  const { data, error } = await supabaseAdmin
    .from("rentals")
    .select("id, client_id, bike_id, status")
    .eq("bike_id", bikeId)
    .eq("status", "active")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const text = optionalString(body.text) || "";
    const paymentDate = optionalString(body.payment_date) || new Date().toISOString().slice(0, 10);
    const method = optionalString(body.method) || "manual_chat";
    const note = optionalString(body.note) || "quick payment/debt text";
    const forceActionRaw = optionalString(body.force_action);
    const forceAction = forceActionRaw === "payment" || forceActionRaw === "debt" ? forceActionRaw : undefined;
    const defaultChargeType = optionalString(body.default_charge_type) || "rent";
    if (!text.trim()) throw new Error("text is required");

    const parsed = parsePaymentOrDebtLines(text, forceAction, defaultChargeType);
    const results = [];

    for (const item of parsed) {
      if (item.action === "debt") {
        const rental = await findActiveRental(item.bike_id);
        if (!rental?.client_id) throw new Error(`${item.line}: active-аренда по велику #${item.bike_id} не найдена`);

        const { data, error } = await supabaseAdmin.rpc("miniapp_create_manual_charge", {
          p_client_id: Number(rental.client_id),
          p_rental_id: Number(rental.id),
          p_bike_id: item.bike_id,
          p_charge_type: item.charge_type,
          p_amount: item.amount,
          p_due_date: paymentDate,
          p_period_start: null,
          p_period_end: null,
          p_note: `${note}; DEBT; source_line="${item.line.replaceAll('"', "'")}"`,
          p_admin_tg_id: auth.telegramId,
        });
        if (error) throw new Error(`${item.line}: ${error.message}`);
        results.push({ ...item, result: data });
      } else {
        const { data, error } = await supabaseAdmin.rpc("miniapp_record_bike_payment", {
          p_bike_id: item.bike_id,
          p_amount: item.amount,
          p_method: method,
          p_payment_date: paymentDate,
          p_note: `${note}; PAYMENT; source_line="${item.line.replaceAll('"', "'")}"`,
          p_admin_tg_id: auth.telegramId,
        });
        if (error) throw new Error(`${item.line}: ${error.message}`);
        results.push({ ...item, result: data });
      }
    }

    return ok({ parsed_count: parsed.length, results });
  } catch (e) {
    return fail(e);
  }
}
