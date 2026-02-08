import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const temp01 = (t) => clamp((t - -10) / (35 - -10), 0, 1); // -10..35 -> 0..1

async function getTempC(placeName) {
  const g = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      placeName
    )}&count=1&language=en&format=json`
  ).then((r) => r.json());

  const top = g?.results?.[0];
  if (!top) throw new Error("Place not found");

  const w = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${top.latitude}&longitude=${top.longitude}&current_weather=true`
  ).then((r) => r.json());

  const t = w?.current_weather?.temperature;
  if (typeof t !== "number") throw new Error("No temperature");

  return t;
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

export default function App() {
  const [q, setQ] = useState("Nicosia");
  const [tempC, setTempC] = useState(null);

  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const particlesRef = useRef([]);
  const mouseRef = useRef({ x: 0, y: 0, inside: false });

  const applyPlace = async () => {
    const name = q.trim();
    if (!name) return;
    try {
      const t = await getTempC(name);
      setTempC(t);
    } catch {
      setTempC(null);
    }
  };

  useEffect(() => {
    applyPlace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background based on temperature (your original idea)
  const k = tempC == null ? 0.5 : temp01(tempC);
  const hue = 210 + (20 - 210) * k;
  const sat = 75;
  const light = 14 + 14 * k;

  // Speed multiplier based on temperature
  // 0.6x (cold) -> 2.2x (hot)
  const speedMul = useMemo(() => {
    const kk = tempC == null ? 0.5 : temp01(tempC);
    return 0.6 + 1.6 * kk;
  }, [tempC]);

  // Particle config (you can tweak these)
  const density = 0.00012; // particles per pixel (approx). Higher = more particles.
  const baseSpeed = 0.55;  // baseline speed before temperature multiplier
  const hoverRadius = 140;
  const linkRadius = 120;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const w = window.innerWidth;
      const h = window.innerHeight;

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Re-seed particles on resize for consistent density
      const count = Math.max(40, Math.floor(w * h * density));
      const arr = new Array(count).fill(0).map(() => {
        const r = rand(1.2, 3.0);
        const ang = rand(0, Math.PI * 2);
        return {
          x: rand(0, w),
          y: rand(0, h),
          vx: Math.cos(ang),
          vy: Math.sin(ang),
          r,
          // a tiny per-particle speed variance
          s: rand(0.7, 1.3),
        };
      });
      particlesRef.current = arr;
    };

    const onMouseMove = (e) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      mouseRef.current.inside = true;
    };

    const onMouseLeave = () => {
      mouseRef.current.inside = false;
    };

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);

    resize();

    let last = performance.now();

    const tick = (now) => {
      const dtMs = now - last;
      last = now;

      // Clamp dt to avoid huge jumps when tab was inactive
      const dt = clamp(dtMs / 16.6667, 0.2, 2.0);

      const w = window.innerWidth;
      const h = window.innerHeight;

      // Clear with slight transparency for subtle trails (optional).
      // If you want no trails, set alpha to 1.0.
      ctx.clearRect(0, 0, w, h);

      const particles = particlesRef.current;
      const mouse = mouseRef.current;

      // Color derived from temp (slightly brighter than background)
      const pLight = 70;
      const pSat = 80;
      const particleColor = `hsl(${hue} ${pSat}% ${pLight}%)`;

      // Links: draw faint lines between close particles (and slightly stronger near mouse)
      ctx.lineWidth = 1;

      // Update + draw particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Temperature-driven speed
        const sp = baseSpeed * speedMul * p.s;

        // Hover interaction: repel when mouse is near
        if (mouse.inside) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          const r2 = hoverRadius * hoverRadius;

          if (d2 < r2 && d2 > 0.0001) {
            const d = Math.sqrt(d2);
            const t = 1 - d / hoverRadius; // 0..1
            // Push away stronger closer to mouse
            const push = 0.9 * t;

            // Add a little swirl so it feels "interactive", not just repulsion
            const nx = dx / d;
            const ny = dy / d;

            // repulsion
            p.vx += nx * push * 0.12;
            p.vy += ny * push * 0.12;

            // swirl (perpendicular)
            p.vx += -ny * push * 0.05;
            p.vy += nx * push * 0.05;
          }
        }

        // Slight random jitter to keep motion organic
        p.vx += rand(-0.015, 0.015);
        p.vy += rand(-0.015, 0.015);

        // Dampen velocity (prevents runaway speeds)
        p.vx *= 0.98;
        p.vy *= 0.98;

        // Normalize direction occasionally so it stays “random directions”
        const vLen = Math.hypot(p.vx, p.vy);
        if (vLen > 2.2) {
          p.vx /= vLen;
          p.vy /= vLen;
        } else if (vLen < 0.15) {
          const ang = rand(0, Math.PI * 2);
          p.vx = Math.cos(ang);
          p.vy = Math.sin(ang);
        }

        // Move
        p.x += p.vx * sp * dt * 2.0;
        p.y += p.vy * sp * dt * 2.0;

        // Bounce edges
        if (p.x < 0) {
          p.x = 0;
          p.vx *= -1;
        } else if (p.x > w) {
          p.x = w;
          p.vx *= -1;
        }
        if (p.y < 0) {
          p.y = 0;
          p.vy *= -1;
        } else if (p.y > h) {
          p.y = h;
          p.vy *= -1;
        }

        // Draw particle
        ctx.beginPath();
        ctx.fillStyle = particleColor;
        ctx.globalAlpha = 0.9;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw links (O(n^2) is okay for modest counts; keep density reasonable)
      ctx.globalAlpha = 1.0;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < linkRadius * linkRadius) {
            const d = Math.sqrt(d2);
            const t = 1 - d / linkRadius; // 0..1
            ctx.strokeStyle = particleColor;
            ctx.globalAlpha = 0.18 * t;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Extra mouse “aura” links: highlight nearby particles
      if (mouse.inside) {
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < hoverRadius * hoverRadius) {
            const d = Math.sqrt(d2);
            const t = 1 - d / hoverRadius;
            ctx.strokeStyle = particleColor;
            ctx.globalAlpha = 0.28 * t;
            ctx.beginPath();
            ctx.moveTo(mouse.x, mouse.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }
        }
      }

      ctx.globalAlpha = 1.0;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [hue, speedMul]); // re-color + re-speed when temperature changes

  return (
    <div
      className="root"
      style={{
        background: `hsl(${hue} ${sat}% ${light}%)`,
        transition: "background 400ms ease",
      }}
    >
      <canvas ref={canvasRef} className="fx" />

      <div className="ui">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyPlace()}
          placeholder="City or country (Enter)"
        />
        <div className="temp">
          {typeof tempC === "number" ? `${Math.round(tempC)}°C` : "—"}
        </div>

        <div className="hint">
          Hover to interact · speed scales with temperature
        </div>
      </div>
    </div>
  );
}
