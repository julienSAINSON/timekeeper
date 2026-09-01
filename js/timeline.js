import { formatClock } from "./timer.js";

function slotClass({ isCurrent, isCompleted, tone, overrunMs }) {
  const classes = ["timeline-slot"];
  if (isCompleted) {
    classes.push("completed");
  }
  if (isCurrent) {
    classes.push("current", `status-${tone}`);
  }
  if (overrunMs > 0) {
    classes.push("late");
  }
  return classes.join(" ");
}

export function renderTimeline(
  trackElement,
  markerElement,
  slotTimings,
  elapsedMs,
  currentSlide,
  totalDebtMs = 0,
  initialDelayMs = 0,
  slotOverrunsMs = {},
  currentOverrunMs = 0,
  totalDurationMs = slotTimings.at(-1)?.endOffsetMs ?? 1,
  unallocatedDurationMs = 0,
  slotReductionsMs = {},
  currentSlotElapsedMs = 0,
  initialAdvanceMs = 0,
) {
  const totalOverrunMs = totalDebtMs;
  const overflowDurationMs = Math.max(0, totalOverrunMs - unallocatedDurationMs);
  const remainingInitialAdvanceMs = Math.max(0, initialAdvanceMs - elapsedMs);
  const displayDurationMs =
    totalDurationMs + initialDelayMs + remainingInitialAdvanceMs + overflowDurationMs;
  const remainingUnallocatedDurationMs = Math.max(0, unallocatedDurationMs - totalOverrunMs);
  trackElement.innerHTML = "";

  if (remainingInitialAdvanceMs > 0) {
    const item = document.createElement("article");
    const name = document.createElement("strong");
    const duration = document.createElement("small");

    item.className = "timeline-slot start-early";
    item.style.width = `${(remainingInitialAdvanceMs / displayDurationMs) * 100}%`;
    name.textContent = "Démarrage anticipé";
    duration.textContent = `-${formatClock(remainingInitialAdvanceMs)}`;
    item.append(name, duration);
    trackElement.appendChild(item);
  }

  if (initialDelayMs > 0) {
    const item = document.createElement("article");
    const name = document.createElement("strong");
    const duration = document.createElement("small");

    item.className = "timeline-slot start-delay";
    item.style.width = `${(initialDelayMs / displayDurationMs) * 100}%`;
    name.textContent = "Démarrage tardif";
    duration.textContent = `+${formatClock(initialDelayMs)}`;
    item.append(name, duration);
    trackElement.appendChild(item);
  }

  slotTimings.forEach((slot) => {
    const isCurrent = currentSlide >= slot.startSlide && currentSlide <= slot.endSlide;
    const slotElapsedMs = isCurrent
      ? Math.max(0, currentSlotElapsedMs)
      : Math.max(0, elapsedMs - slot.startOffsetMs);
    const isCompleted = currentSlide > slot.endSlide;
    const overrunMs = isCurrent ? Math.max(0, slotElapsedMs - slot.durationMs) : 0;
    const progress = slot.durationMs > 0 ? slotElapsedMs / slot.durationMs : 0;
    const tone = overrunMs > 0 ? "danger" : progress >= 0.8 && isCurrent ? "warning" : "ok";
    const slotOverrunMs = Number(slotOverrunsMs[slot.id] || 0) + (isCurrent ? currentOverrunMs : 0);
    const actualDurationMs = slot.durationMs + slotOverrunMs;
    const width = `${(actualDurationMs / displayDurationMs) * 100}%`;

    const item = document.createElement("article");
    const name = document.createElement("strong");
    const slides = document.createElement("small");
    const duration = document.createElement("small");

    item.className = slotClass({ isCurrent, isCompleted, tone, overrunMs: slotOverrunMs });
    item.style.width = width;
    name.textContent = slot.name;
    slides.textContent = `Slides ${slot.startSlide} → ${slot.endSlide}`;
    const reductionMs = Number(slotReductionsMs[slot.id] || 0);
    const originalDurationMs = Number(slot.durationMinutes) * 60 * 1000;
    duration.textContent = reductionMs > 0
      ? `${formatClock(originalDurationMs)} → ${formatClock(slot.durationMs)}`
      : slotOverrunMs > 0
        ? `${formatClock(slot.durationMs)} + ${formatClock(slotOverrunMs)}`
        : formatClock(slot.durationMs);
    item.append(name, slides, duration);
    trackElement.appendChild(item);
  });

  if (remainingUnallocatedDurationMs > 0) {
    const item = document.createElement("article");
    const name = document.createElement("strong");
    const duration = document.createElement("small");

    item.className = "timeline-slot unallocated";
    item.style.width = `${(remainingUnallocatedDurationMs / displayDurationMs) * 100}%`;
    name.textContent = "Temps non dédié";
    duration.textContent = formatClock(remainingUnallocatedDurationMs);
    item.append(name, duration);
    trackElement.appendChild(item);
  }

  const markerPositionMs = initialDelayMs + Math.max(0, elapsedMs - initialAdvanceMs);
  const markerRatio = Math.min(markerPositionMs / displayDurationMs, 1);
  markerElement.style.left = `${markerRatio * 100}%`;
}
