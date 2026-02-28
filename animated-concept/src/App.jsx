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

      // cleanup any prior instance
      if (p5Ref.current) {
        try {
          p5Ref.current.remove();
        } catch {}
        p5Ref.current = null;
      }

      const sketch = (p) => {
        // Simplified + faster organism (no offscreen graphics, fewer layers/steps)
        const CFG = {
          bg: [145, 55, 108],
          layers: 22,
          steps: 140,
          extent: 170,
        };

        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const temp01 = (temp) => clamp((temp + 20) / 60, 0, 1); // -20..40 => 0..1
        let tempSmoothed = 20;

        p.setup = () => {
          const c = p.createCanvas(p.windowWidth, p.windowHeight);
          p.pixelDensity(1);
          p.noStroke();

          // Keep UI clickable (canvas should not eat pointer events)
          c.elt.style.position = "absolute";
          c.elt.style.inset = "0";
          c.elt.style.zIndex = "0";
          c.elt.style.pointerEvents = "none";
        };

        p.windowResized = () => {
          p.resizeCanvas(p.windowWidth, p.windowHeight);
        };

        p.draw = () => {
          const tempNow =
            typeof tempRef.current === "number" ? tempRef.current : 20;
          tempSmoothed += (tempNow - tempSmoothed) * 0.04;
          const uT = temp01(tempSmoothed);

          // Warmer -> faster & more energetic
          const speed = 0.35 + uT * 1.0; // 0.35..1.35
          const amp = 18 + uT * 52; // deformation amplitude
          const spin = 0.0008 + uT * 0.0025;

          p.background(CFG.bg[0], CFG.bg[1], CFG.bg[2]);

          const t = p.millis() * 0.001 * speed;
          const cx = p.width / 2;
          const cy = p.height / 2;

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

              const lobe =
                0.55 * Math.sin(a * 2 + ph * 1.1) +
                0.35 * Math.sin(a * 3 - ph * 0.9) +
                0.2 * Math.sin(a * 5 + ph * 0.6);

              const nx = 0.9 + 0.7 * Math.cos(a);
              const ny = 0.9 + 0.7 * Math.sin(a);
              const n = p.noise(
                nx + u * 1.7,
                ny - u * 1.1,
                t * 0.35 + L * 0.03,
              );

              const wave = Math.sin(a * (5.0 + uT * 6.0) + ph * 2.1);

              const r =
                base +
                lobe * 18 +
                (n - 0.5) * 2 * amp * (0.35 + 0.75 * mid) +
                wave * (8 + 10 * mid);

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
              Tip: Warmer places move faster. Try “Cairo”, “Reykjavik”,
              “Sydney”.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
