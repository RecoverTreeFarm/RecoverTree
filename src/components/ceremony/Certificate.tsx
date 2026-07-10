"use client";

import { useRef, useState } from "react";
import { ICON } from "@/lib/icons";

export type CertificateData = {
  seasonName: string;
  farmerName: string;
  avatarSrc: string;
  houseSrc: string;
  houseName: string;
  rank: number | null;
  fruits: number;
  trees: number;
  medal: string | null;
  badges: string[];
};

/**
 * "Download your certificate" — draws the player's farmer in front of their
 * house with the season's stats onto a canvas and saves it as a PNG.
 *
 * Everything is drawn client-side from images the page already loaded, so no
 * server round-trip and no new dependency. Sprites are scaled with smoothing
 * off to keep them crisp.
 */
export function CertificateButton({ data }: { data: CertificateData }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  async function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${src}`));
      img.src = src;
    });
  }

  async function download() {
    setBusy(true);
    setErr(null);
    try {
      const W = 900;
      const H = 640;
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");

      // ---- backdrop: sky over grass, with a cream certificate frame -------
      ctx.fillStyle = "#cbd9c3";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#8caf6b";
      ctx.fillRect(0, H * 0.62, W, H * 0.38);

      ctx.fillStyle = "rgba(247,239,223,0.92)";
      ctx.fillRect(24, 24, W - 48, H - 48);
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#40342a";
      ctx.strokeRect(24, 24, W - 48, H - 48);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ddb56e";
      ctx.strokeRect(40, 40, W - 80, H - 80);

      // ---- title -----------------------------------------------------------
      ctx.textAlign = "center";
      ctx.fillStyle = "#40342a";
      ctx.font = "bold 40px ui-monospace, 'Courier New', monospace";
      ctx.fillText("RecoverTree", W / 2, 96);
      ctx.font = "bold 26px ui-monospace, 'Courier New', monospace";
      ctx.fillText(`${data.seasonName} — Season Certificate`, W / 2, 132);

      // ---- the scene: farmer in front of their house -----------------------
      ctx.imageSmoothingEnabled = false;
      const [house, farmer] = await Promise.all([
        loadImage(data.houseSrc),
        loadImage(data.avatarSrc),
      ]);
      const houseH = 210;
      const houseW = (house.width / house.height) * houseH;
      const groundY = 452;
      ctx.drawImage(house, W / 2 - houseW / 2, groundY - houseH, houseW, houseH);
      const farmerH = 120;
      const farmerW = (farmer.width / farmer.height) * farmerH;
      ctx.drawImage(farmer, W / 2 - farmerW / 2, groundY - farmerH + 8, farmerW, farmerH);
      ctx.imageSmoothingEnabled = true;

      // farmer name + house
      ctx.fillStyle = "#40342a";
      ctx.font = "bold 24px ui-monospace, 'Courier New', monospace";
      ctx.fillText(data.farmerName, W / 2, groundY + 34);
      ctx.font = "16px ui-monospace, 'Courier New', monospace";
      ctx.fillStyle = "#71604d";
      ctx.fillText(`of the ${data.houseName}`, W / 2, groundY + 58);

      // ---- stats -----------------------------------------------------------
      const stats: string[] = [
        `${ICON.fruit} ${data.fruits} Fruits harvested`,
        `${ICON.tree} ${data.trees} Trees grown`,
      ];
      if (data.rank) stats.unshift(`#${data.rank} on the leaderboard`);
      if (data.medal) stats.push(`🏅 ${data.medal} medal`);
      if (data.badges.length) stats.push(`🎖️ ${data.badges.join(", ")}`);

      ctx.textAlign = "left";
      ctx.font = "18px ui-monospace, 'Courier New', monospace";
      ctx.fillStyle = "#40342a";
      stats.forEach((line, i) => {
        ctx.fillText(line, 80, 200 + i * 30);
      });

      ctx.textAlign = "center";
      ctx.font = "italic 15px ui-monospace, 'Courier New', monospace";
      ctx.fillStyle = "#71604d";
      ctx.fillText("Showing up is the real win. 💛", W / 2, H - 62);

      // ---- save ------------------------------------------------------------
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `recovertree-${data.seasonName.toLowerCase()}-certificate.png`;
      a.click();
    } catch {
      setErr("Couldn’t make the certificate just now — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className="pixel-btn pixel-btn--secondary disabled:opacity-50"
      >
        {busy ? "Drawing…" : "🖼️ Download your certificate"}
      </button>
      {err && <p className="mt-1 text-[11px] font-bold text-[var(--rf-red)]">{err}</p>}
      <canvas ref={canvasRef} className="hidden" aria-hidden />
    </>
  );
}
