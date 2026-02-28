import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

export default function App() {
  const mountRef = useRef(null);
  const p5Ref = useRef(null);

  const [query, setQuery] = useState("Nicosia");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [placeLabel, setPlaceLabel] = useState("Nicosia");
  const [tempC, setTempC] = useState(null);

  // p5 reads this without React rerenders
  const tempRef = useRef(20);

  const tempDisplay = useMemo(() => {
    if (tempC == null || Number.isNaN(tempC)) return "–";
    return `${tempC.toFixed(1)}°C`;
  }, [tempC]);

  async function fetchWeather(locationName) {
    setLoading(true);
    setError("");

    try {
      const name = locationName.trim();
      if (!name) throw new Error("Please enter a location.");

      // 1) Geocode
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        name,
      )}&count=1&language=en&format=json`;

      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) throw new Error("Geocoding request failed.");
      const geo = await geoRes.json();

      const best = geo?.results?.[0];
      if (!best) throw new Error("Location not found. Try adding a country.");

      const label = [best.name, best.admin1, best.country]
        .filter(Boolean)
        .join(", ");
      setPlaceLabel(label);

      // 2) Current weather
      const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${best.latitude}&longitude=${best.longitude}&current_weather=true`;
      const wxRes = await fetch(wxUrl);
      if (!wxRes.ok) throw new Error("Weather request failed.");
      const wx = await wxRes.json();

      const t = wx?.current_weather?.temperature;
      if (typeof t !== "number")
        throw new Error("Weather data unavailable for this location.");

      setTempC(t);
      tempRef.current = t;
    } catch (e) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchWeather("Nicosia");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const mod = await import("p5");
      if (cancelled) return;
      const p5 = mod.default;

      if (p5Ref.current) {
        try {
          p5Ref.current.remove();
        } catch {}
        p5Ref.current = null;
      }

      const sketch = (p) => {
        const CFG = {
          // Background lerps darker when colder
          bgWarm: [145, 55, 108],
          bgCold: [18, 10, 26],

          layers: 22,
          steps: 140,
          extent: 170,
        };

        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const temp01 = (temp) => clamp((temp + 20) / 60, 0, 1); // -20..40 => 0..1

        let tempSmoothed = 20;

        // Interaction state
        let hover = false;
        let mx = 0;
        let my = 0;

        // Click pulse (shockwave)
        let pulseX = 0;
        let pulseY = 0;
        let pulseT = -999; // time (seconds) since start when last pulse happened

        const nowSeconds = () => p.millis() * 0.001;

        p.setup = () => {
          const c = p.createCanvas(p.windowWidth, p.windowHeight);
          p.pixelDensity(1);
          p.noStroke();

          // Canvas behind UI but still receives pointer events (we attach listeners)
          c.elt.style.position = "absolute";
          c.elt.style.inset = "0";
          c.elt.style.zIndex = "0";
          c.elt.style.pointerEvents = "auto";

          // Make sure the mounting div doesn't block events (canvas sits inside it)
          if (c.elt.parentElement)
            c.elt.parentElement.style.pointerEvents = "none";

          // Events on canvas
          c.elt.addEventListener("pointerenter", () => (hover = true));
          c.elt.addEventListener("pointerleave", () => (hover = false));
          c.elt.addEventListener("pointermove", (e) => {
            const rect = c.elt.getBoundingClientRect();
            mx = e.clientX - rect.left;
            my = e.clientY - rect.top;
          });
          c.elt.addEventListener("pointerdown", (e) => {
            const rect = c.elt.getBoundingClientRect();
            pulseX = e.clientX - rect.left;
            pulseY = e.clientY - rect.top;
            pulseT = nowSeconds();
          });
        };

        p.windowResized = () => {
          p.resizeCanvas(p.windowWidth, p.windowHeight);
        };

        p.draw = () => {
          const tempNow =
            typeof tempRef.current === "number" ? tempRef.current : 20;
          tempSmoothed += (tempNow - tempSmoothed) * 0.04;
          const uT = temp01(tempSmoothed);

          // Temperature -> motion
          const speed = 0.12 + uT * 2.25; // warmer -> faster
          const ampBase = 18 + uT * 52;
          const spin = 0.0008 + uT * 0.0025;

          // Hover influence (slight extra energy)
          const hoverBoost = hover ? 1.18 : 1.0;
          const amp = ampBase * hoverBoost;

          // Background shifts darker when colder
          const br = p.lerp(CFG.bgCold[0], CFG.bgWarm[0], uT);
          const bg = p.lerp(CFG.bgCold[1], CFG.bgWarm[1], uT);
          const bb = p.lerp(CFG.bgCold[2], CFG.bgWarm[2], uT);
          p.background(br, bg, bb);

          const t = nowSeconds() * speed;

          // Center attracted toward mouse when hovering
          const cx0 = p.width / 2;
          const cy0 = p.height / 2;

          let cx = cx0;
          let cy = cy0;

          if (hover) {
            const pull = 0.18; // how much the shape follows the cursor
            cx = cx0 + (mx - cx0) * pull;
            cy = cy0 + (my - cy0) * pull;
          }

          // Click pulse timing
          const dt = nowSeconds() - pulseT; // seconds since click
          // pulseStrength decays over ~1.2s
          const pulseStrength = dt >= 0 ? Math.exp(-dt * 2.2) : 0;

          // Pulse wave radius expands with time
          const pulseRadius = dt >= 0 ? dt * (260 + 240 * uT) : 0;

          p.push();
          p.translate(cx, cy);
          p.rotate(p.frameCount * spin);
          p.blendMode(p.SCREEN);

          for (let L = 0; L < CFG.layers; L++) {
            const u = L / (CFG.layers - 1);
            const mid = 1 - Math.abs(u - 0.5) / 0.5;

            const cool = 0.15 + 0.2 * Math.sin(t * 0.8 + u * p.TWO_PI);
            const cr = p.lerp(255, 185, cool);
            const cg = p.lerp(150, 220, cool);
            const cb = p.lerp(190, 255, cool);
            const alpha = 6 + 18 * Math.pow(mid, 1.2);
            p.fill(cr, cg, cb, alpha);

            const base = CFG.extent * (0.55 + 0.55 * mid) + (u - 0.5) * 55;
            const ph = t * (0.9 + 0.9 * (1 - u)) + L * 0.37;

            p.beginShape();
            for (let i = 0; i <= CFG.steps; i++) {
              const a = (i / CFG.steps) * p.TWO_PI;

              // Organic lobes
              const lobe =
                0.55 * Math.sin(a * 2 + ph * 1.1) +
                0.35 * Math.sin(a * 3 - ph * 0.9) +
                0.2 * Math.sin(a * 5 + ph * 0.6);

              // Perlin radius variation
              const nx = 0.9 + 0.7 * Math.cos(a);
              const ny = 0.9 + 0.7 * Math.sin(a);
              const n = p.noise(
                nx + u * 1.7,
                ny - u * 1.1,
                t * 0.35 + L * 0.03,
              );

              // Traveling wave along angle
              const wave = Math.sin(a * (5.0 + uT * 6.0) + ph * 2.1);

              // Click pulse effect: a ring that expands from click point.
              // Compute this vertex position in screen space (approx) to compare distance.
              // We approximate by mapping the vertex direction into screen coordinates.
              // It's cheap and feels good.
              const approxR = base + lobe * 18;
              const vx = cx + Math.cos(a) * approxR;
              const vy = cy + Math.sin(a) * approxR;

              const distToPulse = Math.hypot(vx - pulseX, vy - pulseY);
              const ring = pulseStrength
                ? Math.exp(-Math.pow((distToPulse - pulseRadius) / 70, 2)) *
                  pulseStrength
                : 0;

              // Hover effect: add a subtle bulge on the side closer to mouse
              let hoverBulge = 0;
              if (hover) {
                const toMouseX = mx - (cx + Math.cos(a) * approxR);
                const toMouseY = my - (cy + Math.sin(a) * approxR);
                const d = Math.hypot(toMouseX, toMouseY);
                hoverBulge = Math.exp(-Math.pow(d / 220, 2)) * 14;
              }

              const r =
                base +
                lobe * 18 +
                (n - 0.5) * 2 * amp * (0.35 + 0.75 * mid) +
                wave * (8 + 10 * mid) +
                ring * (70 + 50 * mid) + // click shockwave
                hoverBulge * (0.6 + 0.7 * mid);

              const squash = 0.9 + 0.08 * Math.sin(t * 0.7 + u * 3.0);
              const x = Math.cos(a) * r;
              const y = Math.sin(a) * r * squash;

              p.vertex(x, y);
            }
            p.endShape(p.CLOSE);
          }

          p.pop();
          p.blendMode(p.BLEND);
        };
      };

      p5Ref.current = new p5(sketch, mountRef.current);
    })();

    return () => {
      cancelled = true;
      if (p5Ref.current) {
        try {
          p5Ref.current.remove();
        } catch {}
        p5Ref.current = null;
      }
    };
  }, []);

  return (
    <div className="wr-root">
      {/* p5 mounts here */}
      <div ref={mountRef} className="wr-canvasMount" />

      {/* UI overlay */}
      <div className="wr-ui">
        <div className="wr-card">
          <div className="wr-topRow">
            <div className="wr-block">
              <div className="wr-label">Location</div>
              <div className="wr-value">{placeLabel}</div>
            </div>
            <div className="wr-block wr-right">
              <div className="wr-label">Temperature</div>
              <div className="wr-temp">{tempDisplay}</div>
            </div>
          </div>

          <form
            className="wr-form"
            onSubmit={(e) => {
              e.preventDefault();
              fetchWeather(query);
            }}
          >
            <input
              className="wr-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g., Tokyo, Japan"
            />
            <button className="wr-button" type="submit" disabled={loading}>
              {loading ? "Loading…" : "Go"}
            </button>
          </form>

          {error ? (
            <div className="wr-error">{error}</div>
          ) : (
            <div className="wr-tip">
              Hover to attract & energize. Click to send a pulse. Warmer =
              faster, colder = darker.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
