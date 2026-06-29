import { NextRequest } from "next/server";
import { fail, ok, optionalString } from "@/lib/http";
import { requireAdmin } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ParsedLine = { line: string; bike_id: number; amount: number };

function parsePaymentLines(text: string): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const normalized = line.replace(",", ".");
      const match = normalized.match(
        /(?:^|\s)#?(\d{1,5})\s*(?:велик|вел|bike|vel|b)?\s+(\d+(?:\.\d{1,2})?)\s*(?:kč|kc|czk|оплата|опл|paid)?/i,
      );
      if (!match)
        throw new Error(
          `Не понял строку: "${line}". Формат: "24 велик 2000 оплата"`,
        );
      return { line, bike_id: Number(match[1]), amount: Number(match[2]) };
    });
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
