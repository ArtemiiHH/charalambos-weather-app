import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const TEMP_SOUND_THRESHOLD_C = 12;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const temp01 = (c) => clamp((c + 20) / 60, 0, 1); // -20..40 -> 0..1

const safePlay = (audio) => {
  if (!audio) return;
  try {
    const p = audio.play();
    if (p?.catch) p.catch(() => {});
  } catch {}
};

async function getLocationAndTemp(name) {
  const q = name.trim();
  if (!q) throw new Error("Please enter a location.");

  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    q,
  )}&count=1&language=en&format=json`;
  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) throw new Error("Geocoding request failed.");
  const geo = await geoRes.json();
  const best = geo?.results?.[0];
  if (!best) throw new Error("Location not found. Try adding a country.");

  const label = [best.name, best.admin1, best.country]
    .filter(Boolean)
    .join(", ");

  const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${best.latitude}&longitude=${best.longitude}&current_weather=true`;
  const wxRes = await fetch(wxUrl);
  if (!wxRes.ok) throw new Error("Weather request failed.");
  const wx = await wxRes.json();

  const t = wx?.current_weather?.temperature;
  if (typeof t !== "number")
    throw new Error("Weather data unavailable for this location.");

  return { label, temp: t };
}

export default function App() {
  const mountRef = useRef(null);
  const p5Ref = useRef(null);

  const [query, setQuery] = useState("Nicosia");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [placeLabel, setPlaceLabel] = useState("Nicosia");
  const [tempC, setTempC] = useState(null);

  const tempRef = useRef(20);

  // audio bundle in one ref
  const audioRef = useRef({
    cold: null,
    warm: null,
    ambient: null,
    ambientStarted: false,
  });

  const tempDisplay = useMemo(() => {
    if (tempC == null || Number.isNaN(tempC)) return "–";
    return `${tempC.toFixed(1)}°C`;
  }, [tempC]);

  // init audio once
  useEffect(() => {
    const cold = new Audio("/sounds/click-cold.mp3");
    const warm = new Audio("/sounds/click-warm.mp3");
    const ambient = new Audio("/sounds/ambient-loop.mp3");
    cold.preload = warm.preload = ambient.preload = "auto";
    cold.volume = warm.volume = 0.6;
    ambient.loop = true;
    ambient.volume = 0.3;

    audioRef.current.cold = cold;
    audioRef.current.warm = warm;
    audioRef.current.ambient = ambient;

    return () => {
      try {
        ambient.pause();
      } catch {}
      audioRef.current = {
        cold: null,
        warm: null,
        ambient: null,
        ambientStarted: false,
      };
    };
  }, []);

  const startAmbientIfNeeded = () => {
    const a = audioRef.current;
    if (!a.ambient || a.ambientStarted) return;
    a.ambientStarted = true;
    safePlay(a.ambient);
  };

  const playClickSound = (temp) => {
    const a = audioRef.current;
    const cold = typeof temp === "number" && temp <= TEMP_SOUND_THRESHOLD_C;
    const snd = cold ? a.cold : a.warm;
    if (!snd) return;
    snd.currentTime = 0;
    safePlay(snd);
  };

  const fetchWeather = async (name) => {
    setLoading(true);
    setError("");
    try {
      const { label, temp } = await getLocationAndTemp(name);
      setPlaceLabel(label);
      setTempC(temp);
      tempRef.current = temp;
    } catch (e) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWeather("Nicosia");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // p5 setup
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { default: p5 } = await import("p5");
      if (cancelled) return;

      p5Ref.current?.remove?.();
      p5Ref.current = null;

      const sketch = (p) => {
        const CFG = {
          bgWarm: [145, 55, 108],
          bgCold: [18, 10, 26],
          layers: 22,
          steps: 140,
          extent: 170,
        };

        const I = {
          hover: false,
          mx: 0,
          my: 0,
          pulseX: 0,
          pulseY: 0,
          pulseT: -999,
        };

        let tempSmoothed = 20;
        const now = () => p.millis() * 0.001;

        p.setup = () => {
          const c = p.createCanvas(p.windowWidth, p.windowHeight);
          p.pixelDensity(1);
          p.noStroke();

          Object.assign(c.elt.style, {
            position: "absolute",
            inset: "0",
            zIndex: "0",
            pointerEvents: "auto",
          });

          if (c.elt.parentElement)
            c.elt.parentElement.style.pointerEvents = "none";

          c.elt.addEventListener("pointerenter", () => (I.hover = true));
          c.elt.addEventListener("pointerleave", () => (I.hover = false));
          c.elt.addEventListener("pointermove", (e) => {
            const r = c.elt.getBoundingClientRect();
            I.mx = e.clientX - r.left;
            I.my = e.clientY - r.top;
          });
          c.elt.addEventListener("pointerdown", (e) => {
            const r = c.elt.getBoundingClientRect();
            I.pulseX = e.clientX - r.left;
            I.pulseY = e.clientY - r.top;
            I.pulseT = now();

            startAmbientIfNeeded();
            playClickSound(tempRef.current);
          });
        };

        p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

        p.draw = () => {
          const tempNow =
            typeof tempRef.current === "number" ? tempRef.current : 20;
          tempSmoothed += (tempNow - tempSmoothed) * 0.04;
          const uT = temp01(tempSmoothed);

          // temp-driven motion + background
          const speed = 0.12 + uT * 2.25;
          const ampBase = 18 + uT * 52;
          const spin = 0.0008 + uT * 0.0025;

          const a = audioRef.current.ambient;
          if (a) a.volume = 0.22 + uT * 0.25;

          p.background(
            p.lerp(CFG.bgCold[0], CFG.bgWarm[0], uT),
            p.lerp(CFG.bgCold[1], CFG.bgWarm[1], uT),
            p.lerp(CFG.bgCold[2], CFG.bgWarm[2], uT),
          );

          const t = now() * speed;

          // hover pull
          const cx0 = p.width / 2,
            cy0 = p.height / 2;
          const cx = I.hover ? cx0 + (I.mx - cx0) * 0.18 : cx0;
          const cy = I.hover ? cy0 + (I.my - cy0) * 0.18 : cy0;

          // pulse
          const dt = now() - I.pulseT;
          const pulseStrength = dt >= 0 ? Math.exp(-dt * 2.2) : 0;
          const pulseRadius = dt >= 0 ? dt * (260 + 240 * uT) : 0;

          const amp = ampBase * (I.hover ? 1.18 : 1);

          p.push();
          p.translate(cx, cy);
          p.rotate(p.frameCount * spin);
          p.blendMode(p.SCREEN);

          for (let L = 0; L < CFG.layers; L++) {
            const u = L / (CFG.layers - 1);
            const mid = 1 - Math.abs(u - 0.5) / 0.5;

            const cool = 0.15 + 0.2 * Math.sin(t * 0.8 + u * p.TWO_PI);
            p.fill(
              p.lerp(255, 185, cool),
              p.lerp(150, 220, cool),
              p.lerp(190, 255, cool),
              6 + 18 * Math.pow(mid, 1.2),
            );

            const base = CFG.extent * (0.55 + 0.55 * mid) + (u - 0.5) * 55;
            const ph = t * (0.9 + 0.9 * (1 - u)) + L * 0.37;

            p.beginShape();
            for (let i = 0; i <= CFG.steps; i++) {
              const ang = (i / CFG.steps) * p.TWO_PI;

              const lobe =
                0.55 * Math.sin(ang * 2 + ph * 1.1) +
                0.35 * Math.sin(ang * 3 - ph * 0.9) +
                0.2 * Math.sin(ang * 5 + ph * 0.6);

              const n = p.noise(
                0.9 + 0.7 * Math.cos(ang) + u * 1.7,
                0.9 + 0.7 * Math.sin(ang) - u * 1.1,
                t * 0.35 + L * 0.03,
              );

              const wave = Math.sin(ang * (5.0 + uT * 6.0) + ph * 2.1);

              const approxR = base + lobe * 18;
              const vx = cx + Math.cos(ang) * approxR;
              const vy = cy + Math.sin(ang) * approxR;

              const distToPulse = Math.hypot(vx - I.pulseX, vy - I.pulseY);
              const ring = pulseStrength
                ? Math.exp(-Math.pow((distToPulse - pulseRadius) / 70, 2)) *
                  pulseStrength
                : 0;

              let hoverBulge = 0;
              if (I.hover) {
                const d = Math.hypot(I.mx - vx, I.my - vy);
                hoverBulge = Math.exp(-Math.pow(d / 220, 2)) * 14;
              }

              const r =
                base +
                lobe * 18 +
                (n - 0.5) * 2 * amp * (0.35 + 0.75 * mid) +
                wave * (8 + 10 * mid) +
                ring * (70 + 50 * mid) +
                hoverBulge * (0.6 + 0.7 * mid);

              const squash = 0.9 + 0.08 * Math.sin(t * 0.7 + u * 3.0);
              p.vertex(Math.cos(ang) * r, Math.sin(ang) * r * squash);
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
      p5Ref.current?.remove?.();
      p5Ref.current = null;
    };
  }, []);

  return (
    <div className="wr-root">
      <div ref={mountRef} className="wr-canvasMount" />

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
              Hover to attract & energize. Click to pulse + sound. Ambient
              starts on first click.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
