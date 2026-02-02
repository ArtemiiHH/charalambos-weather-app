import { useEffect, useRef } from "react";
import p5 from "p5";

export function useP5(sketchFactory, deps = []) {
  const hostRef = useRef(null);
  const p5Ref = useRef(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const sketch = sketchFactory();
    p5Ref.current = new p5(sketch, hostRef.current);

    return () => {
      p5Ref.current?.remove();
      p5Ref.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return hostRef;
}
