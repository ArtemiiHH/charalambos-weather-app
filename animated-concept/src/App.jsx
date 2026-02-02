import React, { useEffect, useState } from "react";
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

export default function App() {
  const [q, setQ] = useState("Nicosia");
  const [tempC, setTempC] = useState(null);

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

  // Change colors
  const k = tempC == null ? 0.5 : temp01(tempC);
  const hue = 210 + (20 - 210) * k;
  const sat = 75;
  const light = 14 + 14 * k;

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        background: `hsl(${hue} ${sat}% ${light}%)`,
        transition: "background 400ms ease",
      }}
    >
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
      </div>
    </div>
  );
}
