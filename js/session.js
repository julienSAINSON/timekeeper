export function createSessionState(firstSlide = 1) {
  return {
    id: crypto.randomUUID(),
    status: "active",
    version: 1,
    isRunning: false,
    isPaused: false,
    currentSlide: firstSlide,
    startedAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    accruedDebtMs: 0,
    initialDelayMs: 0,
    initialAdvanceMs: 0,
    slotOverrunsMs: {},
    slotReductionsMs: {},
    slotStartedElapsedMs: {},
    overrunStrategy: "next",
  };
}