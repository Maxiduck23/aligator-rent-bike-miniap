import { NextRequest } from "next/server";
import { fail, ok, optionalString } from "@/lib/http";
import { requireAdmin } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ParsedLine = { line: string; bike_id: number; amount: number };

function parseAmount(raw: string, suffix?: string): number {
  const normalized = raw.replace(",", ".").trim();
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Некорректная сумма: ${raw}`);
  // 2к / 2k / 2.5к = 2000 / 2500. 2000к не умножаем второй раз.
  if (suffix && /^(к|k)$/i.test(suffix.trim()) && n < 1000) return Math.round(n * 1000);
  return n;
}

function parsePaymentLines(text: string): ParsedLine[] {
  const normalizedText = text
    .replace(/[–—]/g, "-")
    .replace(/\u00a0/g, " ")
    .trim();

  const rawLines = normalizedText
    .split(/\r?\n|;+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const results: ParsedLine[] = [];

  for (const line of rawLines) {
    const matches = Array.from(
      line.matchAll(
        /(?:^|\s)(?:(?:#?(\d{1,5})\s*(?:велик|вел|bike|vel|b|байк)?|(?:велик|вел|bike|vel|b|байк)\s*#?(\d{1,5}))\s*[:=\-]?\s*)(\d+(?:[\.,]\d{1,2})?)\s*(к|k)?\b/giu,
      ),
    );

    if (!matches.length) {
      throw new Error(
        `Не понял строку: "${line}". Примеры: "24 велик 2000 оплата", "25 5к", "вел 31 2500"`,
      );
    }

    for (const match of matches) {
      const bikeId = Number(match[1] || match[2]);
      const amount = parseAmount(match[3], match[4]);
      if (!Number.isFinite(bikeId) || bikeId <= 0) {
        throw new Error(`Некорректный bike_id в строке: "${line}"`);
      }
      results.push({ line: match[0].trim() || line, bike_id: bikeId, amount });
    }
  }

  if (!results.length) throw new Error("Не найдено ни одной оплаты");
  return results;
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const text = optionalString(body.text) || "";
    const paymentDate =
      optionalString(body.payment_date) ||
      new Date().toISOString().slice(0, 10);
    const method = optionalString(body.method) || "manual_chat";
    const note = optionalString(body.note) || "quick payment text";
    if (!text.trim()) throw new Error("text is required");

    const parsed = parsePaymentLines(text);
    const results = [];
    for (const item of parsed) {
      const { data, error } = await supabaseAdmin.rpc(
        "miniapp_record_bike_payment",
        {
          p_bike_id: item.bike_id,
          p_amount: item.amount,
          p_method: method,
          p_payment_date: paymentDate,
          p_note: `${note}; source_line="${item.line.replaceAll('"', "'")}"`,
          p_admin_tg_id: auth.telegramId,
        },
      );
      if (error) throw new Error(`${item.line}: ${error.message}`);
      results.push({ ...item, result: data });
    }
    return ok({ parsed_count: parsed.length, results });
  } catch (e) {
    return fail(e);
  }
}
