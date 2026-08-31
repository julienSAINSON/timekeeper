const STORAGE_KEY = "safe-timekeeper-config-v1";

function createDefaultState() {
  return {
    pdfName: "",
    pageCount: 0,
    slots: [],
    plenary: {
      startTime: "",
      endTime: "",
    },
    presentation: {
      isRunning: false,
      isPaused: false,
      currentSlide: 1,
      startedAt: null,
      pausedAt: null,
      totalPausedMs: 0,
      accruedDebtMs: 0,
      initialDelayMs: 0,
      slotOverrunsMs: {},
    },
  };
}

function timeToMinutes(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

export function getPlenaryDurationMinutes(plenary) {
  const startMinutes = timeToMinutes(plenary.startTime);
  const endMinutes = timeToMinutes(plenary.endTime);

  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return null;
  }

  return endMinutes - startMinutes;
}

export function validatePlenary(plenary, slots) {
  const durationMinutes = getPlenaryDurationMinutes(plenary);
  const slotsDurationMinutes = slots.reduce(
    (sum, slot) => sum + (Number.isFinite(Number(slot.durationMinutes)) ? Number(slot.durationMinutes) : 0),
    0,
  );

  if (durationMinutes === null) {
    return {
      isValid: false,
      durationMinutes: 0,
      unallocatedMinutes: 0,
      message: "Renseignez une heure de début et une heure de fin valides.",
    };
  }

  const unallocatedMinutes = durationMinutes - slotsDurationMinutes;
  if (unallocatedMinutes < 0) {
    return {
      isValid: false,
      durationMinutes,
      unallocatedMinutes,
      message: "La durée des créneaux dépasse la durée totale de la plénière.",
    };
  }

  return {
    isValid: true,
    durationMinutes,
    unallocatedMinutes,
    message:
      unallocatedMinutes > 0
        ? `${unallocatedMinutes} min ne sont pas dédiées aux slides.`
        : "Toute la durée de la plénière est dédiée aux slides.",
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultState();
    }

    return {
      ...createDefaultState(),
      ...JSON.parse(raw),
      presentation: {
        ...createDefaultState().presentation,
        ...JSON.parse(raw).presentation,
      },
    };
  } catch (error) {
    console.warn("Impossible de charger la configuration.", error);
    return createDefaultState();
  }
}

export function saveState(state) {
  const persistedState = {
    ...state,
  };
  delete persistedState.pdfDataUrl;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
}

export function resetState() {
  localStorage.removeItem(STORAGE_KEY);
  return createDefaultState();
}

export function createSlot(pageCount = 0) {
  const lastSlide = pageCount > 0 ? pageCount : 1;
  return {
    id: crypto.randomUUID(),
    name: "Nouveau créneau",
    startSlide: 1,
    endSlide: lastSlide,
    durationMinutes: 5,
  };
}

export function validateSlots(slots, pageCount) {
  const issues = [];
  const coverage = new Set();
  let overlapFound = false;

  slots.forEach((slot, index) => {
    if (!slot.name.trim()) {
      issues.push({
        level: "warn",
        message: `Le créneau ${index + 1} n'a pas de nom.`,
      });
    }

    if (slot.startSlide > slot.endSlide) {
      issues.push({
        level: "error",
        message: `Le créneau "${slot.name || index + 1}" a une slide de début supérieure à la slide de fin.`,
      });
    }

    if (slot.startSlide < 1 || slot.endSlide > pageCount) {
      issues.push({
        level: "error",
        message: `Le créneau "${slot.name || index + 1}" sort des limites du PDF.`,
      });
    }

    const durationMinutes = Number(slot.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      issues.push({
        level: "error",
        message: `Le créneau "${slot.name || index + 1}" doit avoir une durée strictement positive.`,
      });
    }

    for (let slide = slot.startSlide; slide <= slot.endSlide; slide += 1) {
      if (coverage.has(slide)) {
        overlapFound = true;
      }
      coverage.add(slide);
    }
  });

  if (overlapFound) {
    issues.push({
      level: "error",
      message: "Au moins deux créneaux se chevauchent.",
    });
  }

  if (pageCount > 0) {
    const missingSlides = [];
    for (let page = 1; page <= pageCount; page += 1) {
      if (!coverage.has(page)) {
        missingSlides.push(page);
      }
    }

    if (missingSlides.length > 0) {
      issues.push({
        level: "warn",
        message: `Slides non couvertes: ${missingSlides.join(", ")}.`,
      });
    } else {
      issues.push({
        level: "ok",
        message: "Toutes les slides sont couvertes par les créneaux.",
      });
    }
  }

  return {
    issues,
    coveredSlides: coverage.size,
    totalDurationMinutes: slots.reduce(
      (sum, slot) => sum + (Number.isFinite(Number(slot.durationMinutes)) ? Number(slot.durationMinutes) : 0),
      0,
    ),
    isValid:
      pageCount > 0 &&
      slots.length > 0 &&
      !issues.some((issue) => issue.level === "error") &&
      issues.every((issue) => !issue.message.startsWith("Slides non couvertes")),
  };
}
