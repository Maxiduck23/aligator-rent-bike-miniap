"use client";

import { useEffect, useState } from "react";

const blobCache = new Map<string, string>();

function initData() {
  return typeof window === "undefined" ? "" : (window as any).Telegram?.WebApp?.initData || "";
}

export default function ClientAvatarV23({
  mediaId,
  name,
  size = 46,
  thumb = true,
}: {
  mediaId?: number | null;
  name?: string | null;
  size?: number;
  thumb?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(() => {
    if (!mediaId) return null;
    return blobCache.get(`${mediaId}:${thumb ? 1 : 0}`) || null;
  });

  useEffect(() => {
    if (!mediaId) { setSrc(null); return; }
    const key = `${mediaId}:${thumb ? 1 : 0}`;
    const cached = blobCache.get(key);
    if (cached) { setSrc(cached); return; }
    let cancelled = false;
    fetch(`/api/admin/client-media/${mediaId}/content${thumb ? "?thumb=1" : ""}`, {
      headers: { "x-telegram-init-data": initData() },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobCache.set(key, url);
        setSrc(url);
      })
      .catch(() => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [mediaId, thumb]);

  const initial = String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return (
    <div
      className="v23-avatar"
      style={{ width: size, height: size, minWidth: size, borderRadius: Math.round(size * 0.28) }}
      title={name || "Клиент"}
    >
      {src ? <img src={src} alt={name || "Клиент"} /> : <span style={{ fontSize: Math.max(15, Math.round(size * 0.4)) }}>{initial}</span>}
      <style>{`
        .v23-avatar{overflow:hidden;display:flex;align-items:center;justify-content:center;background:rgba(100,160,125,.14);border:1px solid rgba(120,210,155,.18);font-weight:800;flex:none}
        .v23-avatar img{width:100%;height:100%;object-fit:cover;display:block}
      `}</style>
    </div>
  );
}
