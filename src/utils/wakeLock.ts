type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: unknown };
type WakeLockLike = { request: (type: 'screen') => Promise<WakeLockSentinelLike> };

/**
 * Keeps the host's screen awake so the authoritative simulation is not suspended (decision D2).
 * Unsupported on some iOS versions and in-app browsers, so every call is best-effort.
 */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  static get isSupported(): boolean {
    return 'wakeLock' in navigator;
  }

  async acquire(): Promise<void> {
    this.wanted = true;
    await this.request();
  }

  async release(): Promise<void> {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = null;

    try {
      await sentinel?.release();
    } catch {
      // Already released by the browser.
    }
  }

  destroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    void this.release();
  }

  private async request(): Promise<void> {
    if (!this.wanted || this.sentinel || document.hidden) return;

    const api = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!api) return;

    try {
      this.sentinel = await api.request('screen');
    } catch {
      // Denied (low battery, unsupported). The pause path covers us.
    }
  }

  private readonly onVisibilityChange = (): void => {
    // The browser drops the lock whenever the page hides; take it back on return.
    if (document.hidden) {
      this.sentinel = null;
      return;
    }
    void this.request();
  };
}
