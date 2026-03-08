import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

// Temp threshold
const TEMP_SOUND_THRESHOLD_C = 12;

// Clamp a value between a minimum and maximum
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Convert temperature range (-20°C → 40°C)
const temp01 = (c) => clamp((c + 20) / 60, 0, 1);

// Play audio safely
const safePlay = (audio) => {
  if (!audio) return;
  try {
    const p = audio.play();
    if (p?.catch) p.catch(() => {});
  } catch {}
};

// Fetch weather data from Open-Meteo
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
  if (typeof t !== "number") {
    throw new Error("Weather data unavailable for this location.");
  }

  return { label, temp: t };
}

export default function App() {
  const mountRef = useRef(null);
  const p5Ref = useRef(null);
  const videoRef = useRef(null);
  const handLandmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);

  // UI state
  const [query, setQuery] = useState("Nicosia");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [placeLabel, setPlaceLabel] = useState("Nicosia");
  const [tempC, setTempC] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");

  // Temperature stored in ref for p5
  const tempRef = useRef(20);

  // Store audio files
  const audioRef = useRef({
    cold: null,
    warm: null,
    ambient: null,
    ambientStarted: false,
  });

  // Shared hand state for p5
  const handStateRef = useRef({
    enabled: false,
    visible: false,
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.5,
    pinch: false,
    pinchLatched: false,
    spread: 0.5, // 0=tight, 1=expanded
  });

  const tempDisplay = useMemo(() => {
    if (tempC == null || Number.isNaN(tempC)) return "–";
    return `${tempC.toFixed(1)}°C`;
  }, [tempC]);

  // Load audio
  useEffect(() => {
    const cold = new Audio("/sounds/click-cold.mp3");
    const warm = new Audio("/sounds/click-warm.mp3");
    const ambient = new Audio("/sounds/earth-sound.mp3");

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
  }, []);

  // Setup MediaPipe hand tracking + webcam
  useEffect(() => {
    let mounted = true;

    const setupHandTracking = async () => {
      try {
        setCameraError("");

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
        );

        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (!mounted) {
          handLandmarker.close?.();
          return;
        }

        handLandmarkerRef.current = handLandmarker;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 960 },
            height: { ideal: 540 },
          },
          audio: false,
        });

        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();

        handStateRef.current.enabled = true;
        setCameraReady(true);

        const tick = () => {
          if (!mounted) return;

          const v = videoRef.current;
          const landmarker = handLandmarkerRef.current;

          if (
            v &&
            landmarker &&
            v.readyState >= 2 &&
            v.currentTime !== lastVideoTimeRef.current
          ) {
            lastVideoTimeRef.current = v.currentTime;

            const results = landmarker.detectForVideo(v, performance.now());
            const lm = results?.landmarks?.[0];

            if (lm) {
              const tip = lm[8];
              const thumbTip = lm[4];
              const indexTip = lm[8];

              // Mirror X so it feels natural for front camera
              const x = (1 - tip.x) * window.innerWidth;
              const y = tip.y * window.innerHeight;

              const pinchDist = Math.hypot(
                thumbTip.x - indexTip.x,
                thumbTip.y - indexTip.y,
              );

              // Distance -> expansion mapping
              const spreadMin = 0.03;
              const spreadMax = 0.22;
              const spreadRaw = clamp(
                (pinchDist - spreadMin) / (spreadMax - spreadMin),
                0,
                1,
              );

              const pinch = pinchDist < 0.04;

              const hs = handStateRef.current;
              hs.visible = true;
              hs.x += (x - hs.x) * 0.28;
              hs.y += (y - hs.y) * 0.28;
              hs.spread += (spreadRaw - hs.spread) * 0.22;
              hs.pinch = pinch;
            } else {
              handStateRef.current.visible = false;
              handStateRef.current.pinch = false;
            }
          }

          rafRef.current = requestAnimationFrame(tick);
        };

        tick();
      } catch (err) {
        console.error(err);
        setCameraError(
          "Could not access camera or load hand tracking. Check camera permissions.",
        );
      }
    };

    setupHandTracking();

    return () => {
      mounted = false;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      try {
        handLandmarkerRef.current?.close?.();
      } catch {}

      handLandmarkerRef.current = null;

      const video = videoRef.current;
      const src = video?.srcObject;
      if (src && typeof src.getTracks === "function") {
        src.getTracks().forEach((t) => t.stop());
      }
      if (video) video.srcObject = null;

      handStateRef.current = {
        enabled: false,
        visible: false,
        x: window.innerWidth * 0.5,
        y: window.innerHeight * 0.5,
        pinch: false,
        pinchLatched: false,
        spread: 0.5,
      };
    };
  }, []);

  // P5 animation
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

        const triggerPulse = (x, y) => {
          I.pulseX = x;
          I.pulseY = y;
          I.pulseT = now();

          startAmbientIfNeeded();
          playClickSound(tempRef.current);
        };

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

          c.elt.addEventListener("pointerenter", () => {
            I.hover = true;
          });

          c.elt.addEventListener("pointerleave", () => {
            I.hover = false;
          });

          c.elt.addEventListener("pointermove", (e) => {
            const r = c.elt.getBoundingClientRect();
            I.mx = e.clientX - r.left;
            I.my = e.clientY - r.top;
          });

          c.elt.addEventListener("pointerdown", (e) => {
            const r = c.elt.getBoundingClientRect();
            const x = e.clientX - r.left;
            const y = e.clientY - r.top;
            triggerPulse(x, y);
          });
        };

        p.windowResized = () => {
          p.resizeCanvas(p.windowWidth, p.windowHeight);
        };

        p.draw = () => {
          // Smooth temperature
          const tempNow =
            typeof tempRef.current === "number" ? tempRef.current : 20;
          tempSmoothed += (tempNow - tempSmoothed) * 0.04;
          const uT = temp01(tempSmoothed);

          const hs = handStateRef.current;
          const handSpread = hs.enabled && hs.visible ? hs.spread : 0.5;
          const densityT = 1 - handSpread;

          // Motion + form derived from temp and hand spread
          const speed = 0.12 + uT * 2.25;
          const ampBase = (18 + uT * 52) * (0.7 + handSpread * 0.9);
          const spin = 0.0008 + uT * 0.0025;

          const extentScale = 0.72 + handSpread * 0.7;
          const noiseScale = 0.45 + handSpread * 1.15;
          const lobeScale = 0.7 + handSpread * 0.7;
          const hoverBulgeScale = 0.8 + handSpread * 0.8;
          const alphaBoost = 1.2 + densityT * 0.8;

          const ambient = audioRef.current.ambient;
          if (ambient) ambient.volume = 0.22 + uT * 0.25;

          p.background(
            p.lerp(CFG.bgCold[0], CFG.bgWarm[0], uT),
            p.lerp(CFG.bgCold[1], CFG.bgWarm[1], uT),
            p.lerp(CFG.bgCold[2], CFG.bgWarm[2], uT),
          );

          const t = now() * speed;

          // Mouse fallback
          let inputHover = I.hover;
          let inputX = I.mx;
          let inputY = I.my;

          // Hand overrides mouse when visible
          if (hs.enabled && hs.visible) {
            inputHover = true;
            inputX = hs.x;
            inputY = hs.y;

            if (hs.pinch && !hs.pinchLatched) {
              hs.pinchLatched = true;
              triggerPulse(inputX, inputY);
            } else if (!hs.pinch) {
              hs.pinchLatched = false;
            }
          }

          const cx0 = p.width / 2;
          const cy0 = p.height / 2;
          const cx = inputHover ? cx0 + (inputX - cx0) * 0.18 : cx0;
          const cy = inputHover ? cy0 + (inputY - cy0) * 0.18 : cy0;

          const dt = now() - I.pulseT;
          const pulseStrength = dt >= 0 ? Math.exp(-dt * 2.2) : 0;
          const pulseRadius = dt >= 0 ? dt * (260 + 240 * uT) : 0;

          const amp = ampBase * (inputHover ? 1.18 : 1);

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
              (6 + 18 * Math.pow(mid, 1.2)) * alphaBoost,
            );

            const base =
              CFG.extent * extentScale * (0.55 + 0.55 * mid) +
              (u - 0.5) * 55 * (0.8 + handSpread * 0.5);

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

              const approxR = base + lobe * 18 * lobeScale;
              const vx = cx + Math.cos(ang) * approxR;
              const vy = cy + Math.sin(ang) * approxR;

              const distToPulse = Math.hypot(vx - I.pulseX, vy - I.pulseY);
              const ring = pulseStrength
                ? Math.exp(-Math.pow((distToPulse - pulseRadius) / 70, 2)) *
                  pulseStrength
                : 0;

              let hoverBulge = 0;
              if (inputHover) {
                const d = Math.hypot(inputX - vx, inputY - vy);
                hoverBulge =
                  Math.exp(-Math.pow(d / (180 + handSpread * 90), 2)) *
                  14 *
                  hoverBulgeScale;
              }

              const r =
                base +
                lobe * 18 * lobeScale +
                (n - 0.5) * 2 * amp * noiseScale * (0.35 + 0.75 * mid) +
                wave * (8 + 10 * mid) * (0.75 + handSpread * 0.7) +
                ring * (70 + 50 * mid) * (0.85 + handSpread * 0.5) +
                hoverBulge * (0.6 + 0.7 * mid);

              const squash =
                0.92 + (0.05 + handSpread * 0.06) * Math.sin(t * 0.7 + u * 3.0);

              p.vertex(Math.cos(ang) * r, Math.sin(ang) * r * squash);
            }
            p.endShape(p.CLOSE);
          }

          p.pop();
          p.blendMode(p.BLEND);

          // Optional hand cursor debug dot
          if (hs.enabled && hs.visible) {
            p.push();
            p.noStroke();
            p.fill(255, 255, 255, 180);
            p.circle(inputX, inputY, 14);
            p.pop();
          }
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
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{ display: "none" }}
      />

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
          ) : cameraError ? (
            <div className="wr-error">{cameraError}</div>
          ) : (
            <div className="wr-tip">
              {cameraReady
                ? "Move your hand to attract the organism. Bring fingers together to tighten it. Open them to expand. Pinch to pulse."
                : "Loading camera + hand tracking..."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
