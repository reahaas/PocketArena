/**
 * Mobile browsers resize the viewport as chrome appears, on rotation, and on keyboard show/hide,
 * and `window.innerHeight` lags behind all three (spec §20). visualViewport is the reliable
 * source, so everything that needs the real size goes through here.
 */
export function watchViewport(onResize: (width: number, height: number) => void): () => void {
  const visual = window.visualViewport;
  let frame = 0;

  const measure = (): void => {
    frame = 0;
    const width = Math.round(visual?.width ?? window.innerWidth);
    const height = Math.round(visual?.height ?? window.innerHeight);
    if (width > 0 && height > 0) onResize(width, height);
  };

  // Rotation fires several events in a burst, and the first ones report stale values.
  const schedule = (): void => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  };

  visual?.addEventListener('resize', schedule);
  visual?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  document.addEventListener('fullscreenchange', schedule);

  measure();
  // Rotation and fullscreen both settle after their event fires, so take a second look.
  const settle = window.setTimeout(measure, 300);
  const settleLate = window.setTimeout(measure, 1000);

  return () => {
    if (frame !== 0) cancelAnimationFrame(frame);
    window.clearTimeout(settle);
    window.clearTimeout(settleLate);
    visual?.removeEventListener('resize', schedule);
    visual?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    document.removeEventListener('fullscreenchange', schedule);
  };
}
