import {
  createSlot,
  getPlenaryEndTime,
  loadState,
  normalizeState,
  saveState,
  validatePlenary,
  validateSlots,
} from "../js/config.js?v=quiz-project-config-v1";
import { createSessionState, normalizeSessionState } from "../js/session.js?v=optional-slot-recovery-v1";
import {
  generateRoomToken,
  getPublicRoomUrl,
  getRoomPath,
  getRoomTokenFromPath,
  isRoomToken,
} from "../js/room.js";
import {
  QUESTION_MAX_LENGTH,
  getQuestionStatusLabel,
  isQuestionStatus,
  validateQuestionText,
} from "../js/questions.js";
import {
  classifyQuizComprehension,
  createQuizConfiguration,
  getQuizComprehensionSignal,
  getParticipantId,
  getQuizMonitoringEntries,
  getQuizResponseRows,
  normalizeQuizConfiguration,
  normalizePublicQuizActivity,
  validateQuizConfiguration,
  validateQuizDraft,
} from "../js/quiz.js?v=quiz-comprehension-signals-v1";
import {
  formatClock,
  getActiveSessionSlots,
  getCurrentSlot,
  getElapsedMs,
  getFutureOptionalSlots,
  getNextAvailableSlide,
  getPlannedElapsedMs,
  getRecoveryRecommendation,
  getRecoverySummary,
  getSessionDelayMs,
  getSlotStatus,
  getSlotTiming,
} from "../js/timer.js?v=recovery-recommendation-v1";
import { calculateSlotReductions } from "../js/overrun.js";
import { renderTimeline } from "../js/timeline.js?v=timeline-unallocated-v2";

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
  const state = normalizeState({
    plenary: { startTime: "09:30", endTime: "11:00" },
    presentation: { currentSlide: 9, startedAt: 123 },
  });
  equal(state.plenary.durationMinutes, 90);
  equal(state.plenary.endTime, "11:00");
  equal(state.presentation, undefined);
});

test("Initialise la nouvelle configuration avec l'heure locale actuelle", () => {
  const storageKey = "safe-timekeeper-config-v1";
  const previousState = localStorage.getItem(storageKey);
  try {
    localStorage.removeItem(storageKey);
    const expectedTime = new Date();
    const state = loadState();
    const expectedStartTime = `${String(expectedTime.getHours()).padStart(2, "0")}:${String(expectedTime.getMinutes()).padStart(2, "0")}`;
    equal(state.plenary.startTime, expectedStartTime);
  } finally {
    if (previousState === null) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, previousState);
    }
  }
});

test("Valide et normalise le texte d'une question audience", () => {
  const result = validateQuestionText("  Pouvez-vous préciser ce point ?  ");
  assert(result.valid);
  equal(result.text, "Pouvez-vous préciser ce point ?");
  assert(!validateQuestionText("   ").valid, "Une question vide doit être refusée.");
  assert(
    !validateQuestionText("x".repeat(QUESTION_MAX_LENGTH + 1)).valid,
    "Une question trop longue doit être refusée.",
  );
});

test("Limite les statuts de question aux valeurs prévues", () => {
  assert(isQuestionStatus("pending"));
  assert(isQuestionStatus("answered"));
  assert(isQuestionStatus("dismissed"));
  assert(isQuestionStatus("cancelled"));
  assert(!isQuestionStatus("deleted"));
  equal(getQuestionStatusLabel("pending"), "En attente");
  equal(getQuestionStatusLabel("cancelled"), "Annulée");
});

test("Valide un quiz de deux à quatre propositions", () => {
  const quiz = validateQuizDraft("  Quelle réponse ? ", [" Une ", "Deux", "", ""]);
  assert(quiz.valid);
  equal(quiz.quiz.question, "Quelle réponse ?");
  equal(quiz.quiz.options.length, 2);
  equal(quiz.quiz.options[0].id, "A");
  assert(!validateQuizDraft("", ["A", "B"]).valid, "La question est obligatoire.");
  assert(!validateQuizDraft("Question", ["A"]).valid, "Deux propositions sont requises.");
  assert(!validateQuizDraft("Question", ["A", "B", "C", "D", "E"]).valid, "Quatre propositions au maximum.");
});

test("Normalise un slot Quiz ancien sans perdre sa configuration", () => {
  const normalized = normalizeState({
    slots: [{
      id: "quiz-slot",
      name: "Quiz",
      type: "quiz",
      startSlide: 2,
      endSlide: 2,
      durationMinutes: 2,
      quiz: {
        id: "quiz-config-id",
        question: "Quelle est la source de vérité ?",
        options: [{ id: "A", label: "ProjectState" }, { id: "B", label: "SessionState" }],
        correctOptionId: "B",
      },
    }],
  }).slots[0];
  equal(normalized.quiz.id, "quiz-config-id");
  equal(normalized.quiz.question, "Quelle est la source de vérité ?");
  equal(normalized.quiz.options[0].label, "ProjectState");
  equal(normalized.quiz.options[3].label, "");
  equal(normalized.quiz.correctOptionId, "B");
});

test("Initialise et valide la configuration d'un Quiz de projet", () => {
  const quiz = createQuizConfiguration();
  equal(quiz.options.map((option) => option.id).join(""), "ABCD");
  assert(!validateQuizConfiguration(quiz).valid, "Un Quiz vide doit être incomplet.");

  quiz.question = "Quel état est persistant ?";
  quiz.options[0].label = "ProjectState";
  quiz.options[1].label = "SessionState";
  quiz.correctOptionId = "A";
  assert(validateQuizConfiguration(quiz).valid, "Deux propositions et une bonne réponse doivent suffire.");

  quiz.options[2].label = "PDF";
  quiz.options[3].label = "Room";
  assert(validateQuizConfiguration(quiz).valid, "Quatre propositions renseignées doivent être valides.");
  quiz.correctOptionId = "D";
  assert(validateQuizConfiguration(quiz).valid);
  quiz.options[3].label = "";
  assert(!validateQuizConfiguration(quiz).valid, "La bonne réponse doit désigner une proposition renseignée.");
});

test("Le DTO public du Quiz ne conserve aucune donnée de correction", () => {
  const publicQuiz = normalizePublicQuizActivity({
    quiz: {
      id: "quiz-id",
      question: "Question publique",
      options: [{ id: "A", label: "Une" }, { id: "B", label: "Deux" }],
      hasResponded: true,
      correctOptionId: "B",
      sessionId: "session-secrète",
    },
  });
  equal(publicQuiz.question, "Question publique");
  equal(publicQuiz.options.length, 2);
  equal(publicQuiz.hasResponded, true);
  assert(!Object.hasOwn(publicQuiz, "correctOptionId"));
  assert(!Object.hasOwn(publicQuiz, "sessionId"));
});

test("Prépare les compteurs à zéro pour un Quiz à deux propositions", () => {
  const quiz = createQuizConfiguration();
  quiz.question = "Question";
  quiz.options[0].label = "ProjectState";
  quiz.options[1].label = "SessionState";
  quiz.correctOptionId = "A";
  const rows = getQuizResponseRows(quiz, {});
  equal(rows.length, 2);
  equal(rows[0].count, 0);
  equal(rows[1].count, 0);
  assert(rows.every((row) => !Object.hasOwn(row, "participant_id")));
});

test("Prépare les compteurs agrégés pour les quatre propositions", () => {
  const quiz = createQuizConfiguration();
  quiz.question = "Question";
  quiz.options.forEach((option) => { option.label = `Option ${option.id}`; });
  quiz.correctOptionId = "D";
  const rows = getQuizResponseRows(quiz, { A: 12, B: 27, C: 3, D: 0 });
  equal(rows.length, 4);
  equal(rows.reduce((total, row) => total + row.count, 0), 42);
  assert(rows.every((row) => !Object.hasOwn(row, "participant_id")));
});

test("Classe le niveau de compréhension aux seuils définis", () => {
  equal(classifyQuizComprehension(null), null);
  equal(classifyQuizComprehension(0.49), "poor");
  equal(classifyQuizComprehension(0.5), "mixed");
  equal(classifyQuizComprehension(0.74), "mixed");
  equal(classifyQuizComprehension(0.75), "good");
  equal(classifyQuizComprehension(1), "good");
});

test("Calcule un signal Quiz sans réponse ni donnée persistée", () => {
  const quiz = createQuizConfiguration();
  quiz.correctOptionId = "B";
  const signal = getQuizComprehensionSignal(quiz, { totalResponses: 0, counts: {} });
  equal(signal.totalResponses, 0);
  equal(signal.correctRate, null);
  equal(signal.classification, null);
  assert(!Object.hasOwn(signal, "correctOptionId"));
  assert(!Object.hasOwn(signal, "participant_id"));
});

test("Calcule des signaux indépendants pour plusieurs Quiz", () => {
  const firstQuiz = createQuizConfiguration();
  firstQuiz.correctOptionId = "A";
  const secondQuiz = createQuizConfiguration();
  secondQuiz.correctOptionId = "B";
  const firstSignal = getQuizComprehensionSignal(firstQuiz, { totalResponses: 4, counts: { A: 3, B: 1 } });
  const secondSignal = getQuizComprehensionSignal(secondQuiz, { totalResponses: 5, counts: { A: 4, B: 1 } });
  equal(firstSignal.correctResponses, 3);
  equal(firstSignal.correctRate, 0.75);
  equal(firstSignal.classification, "good");
  equal(secondSignal.correctResponses, 1);
  equal(secondSignal.classification, "poor");
});

test("Conserve les Quiz rencontrés dans l'ordre de la timeline", () => {
  const firstQuiz = createQuizConfiguration();
  const secondQuiz = createQuizConfiguration();
  const thirdQuiz = createQuizConfiguration();
  const slots = [
    { id: "quiz-1", name: "Quiz 1", type: "quiz", startSlide: 4, endSlide: 5, quiz: firstQuiz },
    { id: "quiz-2", name: "Quiz 2", type: "quiz", startSlide: 10, endSlide: 10, quiz: secondQuiz },
    { id: "quiz-3", name: "Quiz 3", type: "quiz", startSlide: 16, endSlide: 17, quiz: thirdQuiz },
  ];
  const entries = getQuizMonitoringEntries(slots, 10, { "quiz-1": 100, "quiz-2": 200 });
  equal(entries.map((entry) => entry.slot.id).join(","), "quiz-1,quiz-2,quiz-3");
  equal(entries.map((entry) => entry.status).join(","), "completed,active,upcoming");
});

test("Reconstruit un Quiz terminé sans résultat à partir de la session", () => {
  const quiz = createQuizConfiguration();
  const slots = [{ id: "quiz-1", name: "Quiz", type: "quiz", startSlide: 4, endSlide: 4, quiz }];
  const entries = getQuizMonitoringEntries(slots, 8, { "quiz-1": 100 });
  equal(entries[0].status, "completed");
  assert(!Object.hasOwn(entries[0], "participant_id"));
});

test("Ne marque pas un Quiz à venir comme terminé", () => {
  const quiz = createQuizConfiguration();
  const slots = [{ id: "quiz-1", name: "Quiz", type: "quiz", startSlide: 4, endSlide: 4, quiz }];
  const entries = getQuizMonitoringEntries(slots, 2, {});
  equal(entries[0].status, "upcoming");
});

test("Préserve l'identifiant et les options du Quiz lors de la persistence locale", () => {
  const storageKey = "safe-timekeeper-config-v1";
  const previousState = localStorage.getItem(storageKey);
  try {
    const quiz = normalizeQuizConfiguration({
      id: "stable-quiz-id",
      question: "Question préparée",
      options: [{ id: "A", label: "Une" }, { id: "B", label: "Deux" }, { id: "C", label: "Trois" }, { id: "D", label: "Quatre" }],
      correctOptionId: "C",
    });
    saveState({ projectName: "Quiz", slots: [{ id: "quiz-slot", name: "Quiz", type: "quiz", startSlide: 1, endSlide: 1, durationMinutes: 1, optional: false, quiz }], plenary: { startTime: "09:00", durationMinutes: 10 } });
    const restoredQuiz = loadState().slots[0].quiz;
    equal(restoredQuiz.id, "stable-quiz-id");
    equal(restoredQuiz.options.map((option) => option.label).join(","), "Une,Deux,Trois,Quatre");
    equal(restoredQuiz.correctOptionId, "C");
  } finally {
    if (previousState === null) localStorage.removeItem(storageKey); else localStorage.setItem(storageKey, previousState);
  }
});

test("Conserve l'identifiant technique anonyme du participant", () => {
  const key = "safe-timekeeper-participant-id-v1";
  const previous = localStorage.getItem(key);
  try {
    localStorage.removeItem(key);
    const first = getParticipantId();
    equal(getParticipantId(), first);
  } finally {
    if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous);
  }
});

test("Génère des tokens de Room opaques et distincts", () => {
  const firstToken = generateRoomToken();
  const secondToken = generateRoomToken();
  assert(isRoomToken(firstToken), "Le token généré doit être URL-safe et suffisamment long.");
  assert(isRoomToken(secondToken), "Le second token généré doit être URL-safe et suffisamment long.");
  assert(firstToken !== secondToken, "Deux sessions doivent recevoir des tokens de Room distincts.");
});

test("Construit et résout la route publique d'un Room", () => {
  const roomToken = generateRoomToken();
  equal(getRoomPath(roomToken), `/r/${roomToken}`);
  const publicUrl = getPublicRoomUrl(roomToken, "https://timekeeper.example/app/index.html?view=monitoring");
  equal(new URL(publicUrl).pathname, `/app/r/${roomToken}`);
  equal(getRoomTokenFromPath(new URL(publicUrl).pathname), roomToken);
  equal(getRoomTokenFromPath("/r/token-invalide"), null);
});

test("Calcule les heures de fin avec passage de minuit", () => {
  equal(getPlenaryEndTime({ startTime: "23:30", durationMinutes: 90 }), "01:00");
  equal(getPlenaryEndTime({ startTime: "23:30", durationMinutes: 0 }), "");
  equal(getPlenaryEndTime({ startTime: "99:99", durationMinutes: 30 }), "");
});

test("Crée un état de session isolé pour chaque présentation", () => {
  const firstSession = createSessionState(4);
  const secondSession = createSessionState(8);
  firstSession.slotOverrunsMs.slot = 1000;
  equal(firstSession.currentSlide, 4);
  equal(secondSession.currentSlide, 8);
  equal(secondSession.slotOverrunsMs.slot, undefined);
  equal(secondSession.currentSlotId, undefined);
  equal(firstSession.status, "active");
  equal(firstSession.version, 1);
  equal(firstSession.skippedSlotIds.length, 0);
  assert(firstSession.id !== secondSession.id, "Chaque session doit posséder un identifiant distinct.");
});

test("Normalise les créneaux ignorés pour les sessions existantes", () => {
  equal(normalizeSessionState({ id: "legacy" }).skippedSlotIds.length, 0);
  equal(normalizeSessionState({ skippedSlotIds: ["a", "a", 3, "b"] }).skippedSlotIds.join(","), "a,b");
});

test("Le calcul du timer conserve le comportement de pause avec la session", () => {
  const now = Date.now();
  const session = createSessionState(1);
  session.startedAt = now - 10000;
  session.isPaused = true;
  session.pausedAt = now - 2000;
  session.totalPausedMs = 3000;
  const elapsed = getElapsedMs(session);
  assert(elapsed >= 4990 && elapsed <= 5010, `Temps calculé inattendu : ${elapsed}.`);
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

test("Normalise les anciens créneaux comme des présentations obligatoires", () => {
  const state = normalizeState({
    slots: [{ id: "legacy", name: "Introduction", startSlide: 1, endSlide: 5, durationMinutes: 10 }],
  });
  equal(state.slots[0].type, "presentation");
  equal(state.slots[0].optional, false);
});

test("Crée un créneau de présentation obligatoire par défaut", () => {
  const createdSlot = createSlot(4);
  equal(createdSlot.type, "presentation");
  equal(createdSlot.optional, false);
});

test("Conserve les types de créneau et l'optionnel dans la validation existante", () => {
  const slots = [
    { ...slot("presentation", 1, 1, 5), type: "presentation", optional: false },
    { ...slot("question", 2, 2, 5), type: "question", optional: true },
    { ...slot("quiz", 3, 3, 5), type: "quiz", optional: false },
  ];
  const normalizedSlots = normalizeState({ slots }).slots;

  equal(normalizedSlots[0].type, "presentation");
  equal(normalizedSlots[1].type, "question");
  equal(normalizedSlots[1].optional, true);
  equal(normalizedSlots[2].type, "quiz");
  equal(normalizedSlots[2].optional, false);
  assert(validateSlots(normalizedSlots, 3).isValid);
});

test("Préserve les nouveaux attributs après sauvegarde et rechargement local", () => {
  const storageKey = "safe-timekeeper-config-v1";
  const previousState = localStorage.getItem(storageKey);
  try {
    saveState({
      slots: [{ ...slot("question", 1, 1, 5), type: "question", optional: true }],
    });
    const loadedState = loadState();
    equal(loadedState.slots[0].type, "question");
    equal(loadedState.slots[0].optional, true);
  } finally {
    if (previousState === null) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, previousState);
    }
  }
});

test("N'enregistre pas l'état runtime de session dans le projet", () => {
  const storageKey = "safe-timekeeper-config-v1";
  const previousState = localStorage.getItem(storageKey);
  try {
    saveState({
      projectName: "Projet test",
      presentation: createSessionState(3),
    });
    const persistedState = JSON.parse(localStorage.getItem(storageKey));
    equal(persistedState.presentation, undefined);
    equal(loadState().presentation, undefined);
  } finally {
    if (previousState === null) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, previousState);
    }
  }
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

test("Dérive un retard nul au début de la session", () => {
  const session = createSessionState(1);
  session.startedAt = Date.now();
  const delay = getSessionDelayMs(session, getSlotTiming([slot("a", 1, 1, 5)]), 1);
  assert(delay >= 0 && delay < 100, `Retard initial inattendu : ${delay}.`);
  assert(!Object.hasOwn(session, "delay"));
});

test("Dérive le retard ou l'avance depuis la position de slide", () => {
  const timings = getSlotTiming([slot("a", 1, 1, 5), slot("b", 2, 2, 5)]);
  const now = Date.now();
  const lateSession = { startedAt: now - 360000, totalPausedMs: 0, isPaused: false };
  const earlySession = { startedAt: now - 240000, totalPausedMs: 0, isPaused: false };
  const lateDelay = getSessionDelayMs(lateSession, timings, 2);
  const earlyDelay = getSessionDelayMs(earlySession, timings, 2);
  assert(lateDelay >= 59900 && lateDelay <= 60100, `Retard attendu proche de 60 s, obtenu ${lateDelay}.`);
  assert(earlyDelay >= -60100 && earlyDelay <= -59900, `Avance attendue proche de 60 s, obtenue ${earlyDelay}.`);
  equal(getPlannedElapsedMs(timings, 1), 0);
  equal(getPlannedElapsedMs(timings, 2), 300000);
});

test("Propose uniquement les créneaux optionnels futurs non ignorés", () => {
  const slots = [
    { ...slot("past", 1, 1, 2), optional: true },
    { ...slot("current", 2, 2, 3), optional: true },
    { ...slot("required", 3, 3, 4), optional: false },
    { ...slot("available", 4, 5, 5), optional: true },
    { ...slot("skipped", 6, 6, 1), optional: true },
  ];
  const future = getFutureOptionalSlots(slots, 2, ["skipped"]);
  equal(future.map((item) => item.id).join(","), "available");
  equal(getFutureOptionalSlots(slots, 2, []).map((item) => item.id).join(","), "available,skipped");
});

test("Calcule la récupération sélectionnée sans modifier les créneaux", () => {
  const first = { ...slot("first", 3, 3, 3), optional: true };
  const second = { ...slot("second", 4, 4, 2), optional: true };
  const recovery = getRecoverySummary(240000, [first, second]);
  equal(recovery.recoveryMs, 300000);
  equal(recovery.remainingDelayMs, 0);
  equal(first.durationMinutes, 3);
  equal(second.durationMinutes, 2);
});

test("Recommande le minimum de créneaux avec la récupération la plus proche", () => {
  const optionalSlots = [
    { ...slot("question", 3, 3, 2), optional: true },
    { ...slot("quiz", 4, 4, 3), optional: true },
    { ...slot("example", 5, 5, 5), optional: true },
  ];
  const recommendation = getRecoveryRecommendation(240000, optionalSlots);
  equal(recommendation.recoverableMs, 600000);
  equal(recommendation.suggestedSlots.map((item) => item.id).join(","), "example");
  equal(recommendation.fullyRecovers, true);
  equal(optionalSlots.map((item) => item.id).join(","), "question,quiz,example");
});

test("Départage les combinaisons par la plus petite durée pour un même nombre de créneaux", () => {
  const optionalSlots = [
    { ...slot("first", 3, 3, 2), optional: true },
    { ...slot("second", 4, 4, 3), optional: true },
    { ...slot("third", 5, 5, 2), optional: true },
  ];
  const recommendation = getRecoveryRecommendation(240000, optionalSlots);
  equal(recommendation.suggestedSlots.map((item) => item.id).join(","), "first,third");
  equal(getRecoverySummary(240000, recommendation.suggestedSlots).recoveryMs, 240000);
});

test("Ne suggère rien lorsque le retard est nul ou qu'aucun créneau n'est disponible", () => {
  const optionalSlots = [{ ...slot("optional", 3, 3, 2), optional: true }];
  equal(getRecoveryRecommendation(0, optionalSlots).suggestedSlots.length, 0);
  equal(getRecoveryRecommendation(60000, []).suggestedSlots.length, 0);
});

test("Propose le maximum récupérable quand le retard dépasse les créneaux disponibles", () => {
  const optionalSlots = [
    { ...slot("question", 3, 3, 2), optional: true },
    { ...slot("quiz", 4, 4, 3), optional: true },
  ];
  const recommendation = getRecoveryRecommendation(360000, optionalSlots);
  equal(recommendation.suggestedSlots.map((item) => item.id).join(","), "question,quiz");
  equal(recommendation.fullyRecovers, false);
  equal(recommendation.recoverableMs, 300000);
});

test("Ignore les données de compréhension Quiz pour la recommandation", () => {
  const quizSlot = {
    ...slot("quiz", 3, 3, 3),
    optional: true,
    quiz: { correctRate: 0, totalResponses: 999, classification: "insufficient" },
  };
  const recommendation = getRecoveryRecommendation(180000, [quizSlot]);
  equal(recommendation.suggestedSlots[0].id, "quiz");
  equal(recommendation.recoverableMs, 180000);
});

test("Dérive la timeline active sans modifier le planning du projet", () => {
  const projectSlots = [
    { ...slot("required", 1, 1, 5), optional: false },
    { ...slot("removed", 2, 2, 3), optional: true },
    { ...slot("remaining", 3, 3, 2), optional: true },
  ];
  const projectSnapshot = JSON.stringify(projectSlots);
  const activeSlots = getActiveSessionSlots(projectSlots, ["removed"]);
  equal(activeSlots.map((item) => item.id).join(","), "required,remaining");
  equal(JSON.stringify(projectSlots), projectSnapshot);
  equal(getFutureOptionalSlots(projectSlots, 1, ["removed"])[0].id, "remaining");
});

test("Recalcule les offsets et la durée depuis la timeline active", () => {
  const projectSlots = [
    slot("first", 1, 1, 5),
    slot("removed", 2, 2, 3),
    slot("last", 3, 3, 2),
  ];
  const activeTimings = getSlotTiming(getActiveSessionSlots(projectSlots, ["removed"]));
  equal(activeTimings.at(-1).endOffsetMs, 420000);
  equal(getPlannedElapsedMs(activeTimings, 3), 300000);
  const now = Date.now();
  const session = { startedAt: now - 360000, totalPausedMs: 0, isPaused: false };
  const delay = getSessionDelayMs(session, activeTimings, 3);
  assert(delay >= 59900 && delay <= 60100, `Retard adapté inattendu : ${delay}.`);
});

test("La navigation évite les plages de créneaux ignorés", () => {
  const slots = [
    { ...slot("first", 1, 1, 1), optional: false },
    { ...slot("skip", 2, 3, 2), optional: true },
    { ...slot("last", 4, 4, 1), optional: false },
  ];
  equal(getNextAvailableSlide(slots, 1, 4, ["skip"]), 4);
  equal(getNextAvailableSlide(slots, 4, 4, ["skip"], -1), 1);
  equal(getNextAvailableSlide(slots, 1, 4, []), 2);
});

test("Fige le retard pendant la pause et le reprend ensuite", () => {
  const timings = getSlotTiming([slot("a", 1, 1, 5)]);
  const now = Date.now();
  const pausedSession = { startedAt: now - 120000, totalPausedMs: 0, isPaused: true, pausedAt: now - 30000 };
  const pausedDelay = getSessionDelayMs(pausedSession, timings, 1);
  assert(pausedDelay >= 89900 && pausedDelay <= 90100, `Retard en pause inattendu : ${pausedDelay}.`);
  const resumedSession = { startedAt: now - 130000, totalPausedMs: 30000, isPaused: false };
  const resumedDelay = getSessionDelayMs(resumedSession, timings, 1);
  assert(resumedDelay >= 99900 && resumedDelay <= 100100, `Retard après reprise inattendu : ${resumedDelay}.`);
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

test("La timeline termine par le temps non dédié", () => {
  const { track } = renderTestTimeline({
    slots: [slot("slot-1", 1, 1, 5)],
    totalDurationMs: 600000,
    unallocatedDurationMs: 300000,
  });
  const segments = [...track.querySelectorAll(".timeline-slot")];
  equal(segments.at(-1).classList.contains("unallocated"), true);
  const totalWidth = segments.reduce((sum, segment) => sum + Number.parseFloat(segment.style.width), 0);
  assert(Math.abs(totalWidth - 100) < 0.001, `La timeline doit couvrir 100 %, obtenu ${totalWidth} %.`);
});

test("Le délai initial ne laisse pas de vide après le temps non dédié", () => {
  const { track } = renderTestTimeline({
    slots: [slot("slot-1", 1, 1, 5)],
    totalDurationMs: 360000,
    totalDebtMs: 25000,
    initialDelayMs: 25000,
    unallocatedDurationMs: 60000,
  });
  const segments = [...track.querySelectorAll(".timeline-slot")];
  const unallocated = track.querySelector(".timeline-slot.unallocated");
  equal(unallocated.querySelector("small").textContent, "00:35");
  const totalWidth = segments.reduce((sum, segment) => sum + Number.parseFloat(segment.style.width), 0);
  assert(Math.abs(totalWidth - 100) < 0.001, `La timeline doit couvrir 100 %, obtenu ${totalWidth} %.`);
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