import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  UpdateDemoGuide,
  UpdateDemoStep,
} from "../utils/updateDemoGuides";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const TICK_MS = 250;

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function findActiveStep(guide: UpdateDemoGuide, elapsedMs: number): UpdateDemoStep {
  return (
    guide.steps.find(
      (step) => elapsedMs >= step.startMs && elapsedMs < step.endMs,
    ) ??
    guide.steps[guide.steps.length - 1] ??
    guide.steps[0]
  );
}

export function useUpdateDemoPlayback(guide: UpdateDemoGuide) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    readPrefersReducedMotion,
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(() => !readPrefersReducedMotion());
  const isPlayingRef = useRef(isPlaying);

  const setPlaybackState = useCallback((nextIsPlaying: boolean) => {
    isPlayingRef.current = nextIsPlaying;
    setIsPlaying(nextIsPlaying);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      const nextPrefersReducedMotion = Boolean(event.matches);
      setPrefersReducedMotion(nextPrefersReducedMotion);
      if (nextPrefersReducedMotion) {
        setPlaybackState(false);
        setElapsedMs(0);
      }
    };

    handleChange(mediaQuery);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener?.(handleChange);
    return () => mediaQuery.removeListener?.(handleChange);
  }, [setPlaybackState]);

  useEffect(() => {
    if (!isPlaying || prefersReducedMotion) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (!isPlayingRef.current) {
        return;
      }
      setElapsedMs((current) => {
        const next = current + TICK_MS;
        if (next >= guide.durationMs) {
          return guide.durationMs;
        }
        return next;
      });
    }, TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [guide.durationMs, isPlaying, prefersReducedMotion]);

  useEffect(() => {
    if (elapsedMs >= guide.durationMs && isPlaying) {
      setPlaybackState(false);
    }
  }, [elapsedMs, guide.durationMs, isPlaying, setPlaybackState]);

  const pause = useCallback(() => {
    setPlaybackState(false);
  }, [setPlaybackState]);

  const play = useCallback(() => {
    if (!prefersReducedMotion) {
      setPlaybackState(true);
    }
  }, [prefersReducedMotion, setPlaybackState]);

  const replay = useCallback(() => {
    setElapsedMs(0);
    setPlaybackState(!prefersReducedMotion);
  }, [prefersReducedMotion, setPlaybackState]);

  const seekToStep = useCallback(
    (stepId: string) => {
      const step = guide.steps.find((candidate) => candidate.id === stepId);
      if (!step) {
        return;
      }
      setElapsedMs(step.startMs);
      setPlaybackState(!prefersReducedMotion);
    },
    [guide.steps, prefersReducedMotion, setPlaybackState],
  );

  const activeStep = useMemo(
    () => findActiveStep(guide, elapsedMs),
    [elapsedMs, guide],
  );
  const progress =
    guide.durationMs > 0
      ? Math.min(100, Math.round((elapsedMs / guide.durationMs) * 100))
      : 0;

  return {
    activeStep,
    elapsedMs,
    isPlaying,
    pause,
    play,
    prefersReducedMotion,
    progress,
    replay,
    seekToStep,
    usesStaticSteps: prefersReducedMotion,
  };
}
