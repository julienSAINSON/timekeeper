export function getElapsedMs(presentation) {
  if (!presentation.startedAt) {
    return 0;
  }

  const now = presentation.isPaused ? presentation.pausedAt ?? Date.now() : Date.now();
  return Math.max(0, now - presentation.startedAt - presentation.totalPausedMs);
}

export function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatHour(date) {
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getSlotTiming(slots) {
  let elapsedMinutes = 0;

  return slots.map((slot) => {
    const startOffsetMs = elapsedMinutes * 60 * 1000;
    elapsedMinutes += Number(slot.durationMinutes);
    const endOffsetMs = elapsedMinutes * 60 * 1000;

    return {
      ...slot,
      startOffsetMs,
      endOffsetMs,
      durationMs: Number(slot.durationMinutes) * 60 * 1000,
    };
  });
}

export function getCurrentSlot(slotTimings, currentSlide) {
  return slotTimings.find(
    (slot) => currentSlide >= Number(slot.startSlide) && currentSlide <= Number(slot.endSlide),
  ) ?? null;
}

export function getSlotStatus(slot, elapsedMs, currentSlide, inheritedDebtMs = 0) {
  if (!slot) {
    return {
      tone: "ok",
      label: "Hors créneau",
      overrunMs: 0,
      slotElapsedMs: 0,
    };
  }

  const slotElapsedMs = Math.max(0, elapsedMs - slot.startOffsetMs - inheritedDebtMs);
  const progress = slot.durationMs > 0 ? slotElapsedMs / slot.durationMs : 0;
  const stillOnAssignedSlides = currentSlide >= slot.startSlide && currentSlide <= slot.endSlide;
  const overrunMs = Math.max(0, slotElapsedMs - slot.durationMs);

  if (overrunMs > 0 && stillOnAssignedSlides) {
    return {
      tone: "danger",
      label: `RETARD : +${formatClock(overrunMs)}`,
      overrunMs,
      slotElapsedMs,
    };
  }

  if (progress >= 0.8) {
    return {
      tone: "warning",
      label: "Fin proche",
      overrunMs: 0,
      slotElapsedMs,
    };
  }

  return {
    tone: "ok",
    label: "Dans les temps",
    overrunMs: 0,
    slotElapsedMs,
  };
}
