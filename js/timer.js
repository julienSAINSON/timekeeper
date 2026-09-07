export function getElapsedMs(session) {
  if (!session.startedAt) {
    return 0;
  }

  const now = session.isPaused ? session.pausedAt ?? Date.now() : Date.now();
  return Math.max(0, now - session.startedAt - session.totalPausedMs);
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

export function getSlotTiming(slots, slotReductionsMs = {}) {
  let elapsedMinutes = 0;

  return slots.map((slot) => {
    const startOffsetMs = elapsedMinutes * 60 * 1000;
    const durationMs = Math.max(
      1000,
      Number(slot.durationMinutes) * 60 * 1000 - Number(slotReductionsMs[slot.id] || 0),
    );
    elapsedMinutes += durationMs / (60 * 1000);
    const endOffsetMs = elapsedMinutes * 60 * 1000;

    return {
      ...slot,
      startOffsetMs,
      endOffsetMs,
      durationMs,
    };
  });
}

export function getCurrentSlot(slotTimings, currentSlide) {
  return slotTimings.find(
    (slot) => currentSlide >= Number(slot.startSlide) && currentSlide <= Number(slot.endSlide),
  ) ?? null;
}

export function getPlannedElapsedMs(slotTimings, currentSlide) {
  const currentSlot = getCurrentSlot(slotTimings, currentSlide);
  return currentSlot ? currentSlot.startOffsetMs : null;
}

export function getSessionDelayMs(session, slotTimings, currentSlide) {
  const plannedElapsedMs = getPlannedElapsedMs(slotTimings, currentSlide);
  return plannedElapsedMs === null ? null : getElapsedMs(session) - plannedElapsedMs;
}

export function getFutureOptionalSlots(slots, currentSlide, skippedSlotIds = []) {
  const skipped = new Set(skippedSlotIds);
  return (Array.isArray(slots) ? slots : []).filter((slot) => (
    slot?.optional === true
    && Number(slot.startSlide) > currentSlide
    && !skipped.has(slot.id)
  ));
}

export function getRecoverySummary(delayMs, selectedSlots) {
  const recoveryMs = (Array.isArray(selectedSlots) ? selectedSlots : [])
    .reduce((total, slot) => total + Math.max(0, Number(slot.durationMinutes) || 0) * 60 * 1000, 0);
  return { recoveryMs, remainingDelayMs: Math.max(0, delayMs - recoveryMs) };
}

export function getNextAvailableSlide(slots, currentSlide, pageCount, skippedSlotIds, direction = 1) {
  const skipped = new Set(skippedSlotIds);
  let slide = currentSlide + direction;
  while (slide >= 1 && slide <= pageCount) {
    const slot = getCurrentSlot(slots, slide);
    if (!slot || !skipped.has(slot.id)) return slide;
    slide += direction;
  }
  return currentSlide;
}

export function getSlotStatus(slot, slotElapsedMs, currentSlide) {
  if (!slot) {
    return {
      tone: "ok",
      label: "Hors créneau",
      overrunMs: 0,
      slotElapsedMs: 0,
    };
  }

  slotElapsedMs = Math.max(0, slotElapsedMs);
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
