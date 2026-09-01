import {
  createDefaultPresentationState,
  getPlenaryEndTime,
  normalizeState,
  validatePlenary,
  validateSlots,
} from "../js/config.js";
import {
  formatClock,
  getCurrentSlot,
  getElapsedMs,
  getSlotStatus,
  getSlotTiming,
} from "../js/timer.js";
import { calculateSlotReductions } from "../js/overrun.js";
import { renderTimeline } from "../js/timeline.js";

const results = document.querySelector("#results");
const summary = document.querySelector("#summary");
const testCases = [];

function test(name, run) {
  testCases.push({ name, run });
}

function assert(condition, message = "Assertion non satisfaite.") {
  if (!condition) {
    throw new Error(message);
  }
}

function equal(actual, expected, message) {
  assert(Object.is(actual, expected), message || `Attendu ${expected}, obtenu ${actual}.`);
}

function slot(id, startSlide, endSlide, durationMinutes, name = id) {
  return { id, name, startSlide, endSlide, durationMinutes };
}

function renderTestTimeline(options = {}) {
  const track = document.createElement("div");
  const marker = document.createElement("div");
  const slots = options.slots || [slot("slot-1", 1, 2, 5)];
  const timings = getSlotTiming(slots, options.slotReductionsMs || {});
  renderTimeline({
    trackElement: track,
    markerElement: marker,
    slotTimings: timings,
    elapsedMs: options.elapsedMs || 0,
    currentSlide: options.currentSlide || 1,
    totalDebtMs: options.totalDebtMs || 0,
    initialDelayMs: options.initialDelayMs || 0,
    slotOverrunsMs: options.slotOverrunsMs || {},
    currentOverrunMs: options.currentOverrunMs || 0,
    totalDurationMs: options.totalDurationMs || timings.at(-1).endOffsetMs,
    unallocatedDurationMs: options.unallocatedDurationMs || 0,
    slotReductionsMs: options.slotReductionsMs || {},
    currentSlotElapsedMs: options.currentSlotElapsedMs || 0,
    initialAdvanceMs: options.initialAdvanceMs || 0,
  });
  return { track, marker };
}

test("Normalise un ancien projet et calcule son heure de fin", () => {
  const state = normalizeState({ plenary: { startTime: "09:30", endTime: "11:00" } });
  equal(state.plenary.durationMinutes, 90);
  equal(state.plenary.endTime, "11:00");
  equal(state.presentation.initialAdvanceMs, 0);
});

test("Calcule les heures de fin avec passage de minuit", () => {
  equal(getPlenaryEndTime({ startTime: "23:30", durationMinutes: 90 }), "01:00");
  equal(getPlenaryEndTime({ startTime: "23:30", durationMinutes: 0 }), "");
  equal(getPlenaryEndTime({ startTime: "99:99", durationMinutes: 30 }), "");
});

test("Crée un état de présentation isolé pour chaque réinitialisation", () => {
  const firstState = createDefaultPresentationState();
  const secondState = createDefaultPresentationState();
  firstState.slotOverrunsMs.slot = 1000;
  equal(secondState.slotOverrunsMs.slot, undefined);
});

test("Normalise les créneaux restaurés malformés", () => {
  const state = normalizeState({
    slots: [{ id: 1, name: null, startSlide: "2", endSlide: "x", durationMinutes: "5" }],
  });
  equal(state.slots[0].id, "slot-1");
  equal(state.slots[0].name, "");
  equal(state.slots[0].startSlide, 2);
  equal(state.slots[0].endSlide, 0);
  equal(state.slots[0].durationMinutes, 5);
});

test("Valide une plénière avec du temps non dédié", () => {
  const result = validatePlenary({ startTime: "09:00", durationMinutes: 60 }, [slot("a", 1, 1, 45)]);
  assert(result.isValid);
  equal(result.unallocatedMinutes, 15);
});

test("Refuse une plénière dont les créneaux dépassent sa durée", () => {
  const result = validatePlenary({ startTime: "09:00", durationMinutes: 30 }, [slot("a", 1, 1, 31)]);
  assert(!result.isValid);
  equal(result.unallocatedMinutes, -1);
});

test("Détecte les créneaux qui se chevauchent", () => {
  const result = validateSlots([slot("a", 1, 2, 5), slot("b", 2, 3, 5)], 3);
  assert(!result.isValid);
  assert(result.issues.some((issue) => issue.message.includes("chevauchent")));
});

test("Détecte les slides non couvertes", () => {
  const result = validateSlots([slot("a", 1, 1, 5), slot("b", 3, 3, 5)], 3);
  assert(!result.isValid);
  assert(result.issues.some((issue) => issue.message.includes("Slides non couvertes: 2")));
});

test("Valide une couverture complète sans recouvrement", () => {
  const result = validateSlots([slot("a", 1, 2, 5), slot("b", 3, 4, 5)], 4);
  assert(result.isValid);
  equal(result.totalDurationMinutes, 10);
});

test("Construit les offsets temporels des créneaux", () => {
  const timings = getSlotTiming([slot("a", 1, 1, 5), slot("b", 2, 2, 10)]);
  equal(timings[0].startOffsetMs, 0);
  equal(timings[0].endOffsetMs, 300000);
  equal(timings[1].startOffsetMs, 300000);
  equal(timings[1].endOffsetMs, 900000);
});

test("Respecte la durée minimale d'une seconde après réduction", () => {
  const [timing] = getSlotTiming([slot("a", 1, 1, 1)], { a: 60000 });
  equal(timing.durationMs, 1000);
});

test("Réduit les créneaux suivants sans muter les réductions existantes", () => {
  const initialReductions = { next: 60000 };
  const reductions = calculateSlotReductions({
    slots: [slot("current", 1, 1, 5), slot("next", 2, 2, 5), slot("last", 3, 3, 5)],
    completedSlotIndex: 0,
    totalDebtMs: 180000,
    unallocatedDurationMs: 0,
    strategy: "next",
    slotReductionsMs: initialReductions,
  });
  equal(initialReductions.next, 60000);
  equal(reductions.next, 180000);
  equal(reductions.last, 0);
});

test("Réduit les derniers créneaux en priorité", () => {
  const reductions = calculateSlotReductions({
    slots: [slot("current", 1, 1, 5), slot("next", 2, 2, 5), slot("last", 3, 3, 10)],
    completedSlotIndex: 0,
    totalDebtMs: 180000,
    unallocatedDurationMs: 0,
    strategy: "last",
  });
  equal(reductions.next, 0);
  equal(reductions.last, 180000);
});

test("Répartit proportionnellement les réductions entre les créneaux restants", () => {
  const reductions = calculateSlotReductions({
    slots: [slot("current", 1, 1, 5), slot("first", 2, 2, 5), slot("second", 3, 3, 5)],
    completedSlotIndex: 0,
    totalDebtMs: 180000,
    unallocatedDurationMs: 0,
    strategy: "proportional",
  });
  equal(reductions.first, 90000);
  equal(reductions.second, 90000);
});

test("Ne réduit aucun créneau lorsque la stratégie décale la fin", () => {
  const initialReductions = { next: 30000 };
  const reductions = calculateSlotReductions({
    slots: [slot("current", 1, 1, 5), slot("next", 2, 2, 5)],
    completedSlotIndex: 0,
    totalDebtMs: 60000,
    unallocatedDurationMs: 0,
    strategy: "shift-end",
    slotReductionsMs: initialReductions,
  });
  equal(initialReductions.next, 30000);
  equal(reductions.next, 30000);
});

test("Retrouve le créneau correspondant à une slide", () => {
  const timings = getSlotTiming([slot("a", 1, 2, 5), slot("b", 3, 4, 5)]);
  equal(getCurrentSlot(timings, 3).id, "b");
  equal(getCurrentSlot(timings, 5), null);
});

test("Calcule le temps écoulé en tenant compte d'une pause", () => {
  const now = Date.now();
  const elapsed = getElapsedMs({ startedAt: now - 10000, isPaused: true, pausedAt: now - 2000, totalPausedMs: 3000 });
  assert(elapsed >= 4990 && elapsed <= 5010, `Temps calculé inattendu : ${elapsed}.`);
});

test("Affiche correctement les formats de chronomètre", () => {
  equal(formatClock(-1), "00:00");
  equal(formatClock(61000), "01:01");
  equal(formatClock(3600000), "60:00");
});

test("Applique les seuils vert, orange et rouge au créneau courant", () => {
  const currentSlot = getSlotTiming([slot("a", 1, 1, 5)])[0];
  equal(getSlotStatus(currentSlot, 239000, 1).tone, "ok");
  equal(getSlotStatus(currentSlot, 240000, 1).tone, "warning");
  const late = getSlotStatus(currentSlot, 301000, 1);
  equal(late.tone, "danger");
  equal(late.overrunMs, 1000);
});

test("La timeline affiche le temps de démarrage tardif", () => {
  const { track, marker } = renderTestTimeline({ initialDelayMs: 60000, elapsedMs: 30000 });
  equal(track.querySelector(".start-delay small").textContent, "+01:00");
  assert(Number.parseFloat(marker.style.left) > 0);
});

test("Le démarrage anticipé diminue et bloque le curseur à gauche", () => {
  const { track, marker } = renderTestTimeline({ initialAdvanceMs: 120000, elapsedMs: 60000 });
  equal(track.querySelector(".start-early small").textContent, "-01:00");
  equal(marker.style.left, "0%");
});

test("Le démarrage anticipé disparaît à l'heure prévue", () => {
  const { track, marker } = renderTestTimeline({ initialAdvanceMs: 120000, elapsedMs: 120000 });
  equal(track.querySelector(".start-early"), null);
  equal(marker.style.left, "0%");
});

test("Le curseur avance après consommation de l'avance initiale", () => {
  const { marker } = renderTestTimeline({ initialAdvanceMs: 120000, elapsedMs: 180000 });
  equal(marker.style.left, "20%");
});

test("La timeline n'additionne pas l'ancien dépassement au dépassement courant", () => {
  const { track } = renderTestTimeline({
    elapsedMs: 420000,
    currentSlotElapsedMs: 420000,
    slotOverrunsMs: { "slot-1": 60000 },
    currentOverrunMs: 120000,
    totalDebtMs: 120000,
  });
  equal(track.querySelector(".timeline-slot small:last-child").textContent, "05:00 + 02:00");
});

test("La timeline montre les réductions de créneau", () => {
  const { track } = renderTestTimeline({ slotReductionsMs: { "slot-1": 120000 } });
  equal(track.querySelector(".timeline-slot small:last-child").textContent, "05:00 → 03:00");
});

const outcomes = [];
for (const testCase of testCases) {
  try {
    await testCase.run();
    outcomes.push({ name: testCase.name, passed: true });
  } catch (error) {
    outcomes.push({ name: testCase.name, passed: false, error });
  }
}

outcomes.forEach((outcome) => {
  const item = document.createElement("li");
  item.className = outcome.passed ? "pass" : "fail";
  item.textContent = outcome.passed ? `OK - ${outcome.name}` : `ECHEC - ${outcome.name}`;
  if (!outcome.passed) {
    const error = document.createElement("span");
    error.className = "error";
    error.textContent = outcome.error.message;
    item.appendChild(error);
  }
  results.appendChild(item);
});

const failedCount = outcomes.filter((outcome) => !outcome.passed).length;
summary.className = failedCount ? "fail" : "pass";
summary.textContent = failedCount
  ? `${failedCount} test(s) en échec sur ${outcomes.length}.`
  : `${outcomes.length} tests réussis.`;