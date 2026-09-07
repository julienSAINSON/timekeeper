const STORAGE_KEY = "safe-timekeeper-config-v1";
const LOCAL_SESSION_KEY = "safe-timekeeper-active-session-v1";
const results = document.querySelector("#results");
const summary = document.querySelector("#summary");
const applicationFrame = document.querySelector("#application");
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

async function waitFor(check, message, timeoutMs = 15000) {
  const startedAt = performance.now();
  while (!check()) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error(message);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}

async function loadApplication() {
  const loaded = new Promise((resolve) => applicationFrame.addEventListener("load", resolve, { once: true }));
  applicationFrame.src = `../index.html?e2e=${Date.now()}`;
  await loaded;
  await waitFor(
    () => applicationFrame.contentDocument?.querySelector("#accessScreen:not([hidden])"),
    "L'écran d'accès ne s'est pas initialisé.",
  );
  applicationFrame.contentDocument.querySelector("#sandboxBtn").click();
  await waitFor(
    () => applicationFrame.contentDocument?.querySelector("#configView.active"),
    "L'application ne s'est pas initialisée.",
  );
  return applicationFrame.contentDocument;
}

async function loadMonitoringApplication() {
  const monitoringFrame = document.createElement("iframe");
  monitoringFrame.hidden = true;
  document.body.appendChild(monitoringFrame);
  const loaded = new Promise((resolve) => monitoringFrame.addEventListener("load", resolve, { once: true }));
  monitoringFrame.src = `../index.html?view=monitoring&e2e=${Date.now()}`;
  await loaded;
  await waitFor(
    () => monitoringFrame.contentDocument?.querySelector("#presentationView.active"),
    "La vue Monitoring ne s'est pas initialisée.",
  );
  return monitoringFrame;
}

async function loadApplicationAt(url) {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  document.body.appendChild(frame);
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  frame.src = url;
  await loaded;
  await waitFor(
    () => frame.contentDocument?.querySelector("#presentationView.active"),
    "La vue Monitoring ne s'est pas initialisée.",
  );
  return frame;
}

function updateInput(documentToTest, selector, value) {
  const input = documentToTest.querySelector(selector);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function importFixture(documentToTest) {
  const response = await fetch("./fixtures/test.pdf");
  assert(response.ok, "La fixture PDF est introuvable.");
  const file = new File([await response.blob()], "test.pdf", { type: "application/pdf" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = documentToTest.querySelector("#pdfInput");
  Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event("change", { bubbles: true }));

  await waitFor(
    () => documentToTest.querySelector("#pdfUploadCard").classList.contains("pdf-ready"),
    "L'import du PDF n'est pas terminé.",
  );
}

function changeInput(documentToTest, selector, value) {
  updateInput(documentToTest, selector, value);
  documentToTest.querySelector(selector).dispatchEvent(new Event("change", { bubbles: true }));
}

function storedSlots(documentToTest) {
  return JSON.parse(documentToTest.defaultView.localStorage.getItem(STORAGE_KEY)).slots;
}

function chooseWizardType(documentToTest, type) {
  const option = documentToTest.querySelector(`input[name="slotWizardType"][value="${type}"]`);
  option.checked = true;
  option.dispatchEvent(new Event("change", { bubbles: true }));
  documentToTest.querySelector("#slotWizardTypeNextBtn").click();
}

test("Importe la fixture PDF et exécute le parcours de présentation", async () => {
  const previousState = localStorage.getItem(STORAGE_KEY);
  try {
    localStorage.removeItem(STORAGE_KEY);
    const documentToTest = await loadApplication();
    await importFixture(documentToTest);

    assert(documentToTest.querySelector("#pdfName").textContent === "test.pdf", "Le nom du PDF est incorrect.");
    assert(documentToTest.querySelector("#pageCount").textContent === "6", "Le PDF devrait contenir six pages.");

    updateInput(documentToTest, "#plenaryStart", "09:00");
    updateInput(documentToTest, "#plenaryDurationInput", "30");
    const startButton = documentToTest.querySelector("#startPresentationBtn");
    assert(!startButton.disabled, "Le démarrage devrait être disponible après configuration.");
    startButton.click();
    documentToTest.querySelector('#strategyDialog button[value="confirm"]').click();

    await waitFor(
      () => documentToTest.querySelector("#presentationView").classList.contains("active"),
      "La présentation ne s'est pas lancée.",
    );
    assert(
      documentToTest.defaultView.location.search === "?view=presentation",
      "Le démarrage local doit ouvrir la route Présentation.",
    );
    await waitFor(
      () => documentToTest.querySelector("#pdfCanvas").width > 0,
      "Le PDF n'a pas été rendu dans le canvas.",
    );

    const slideCounter = documentToTest.querySelector("#slideCounter");
    const counterBounds = slideCounter.getBoundingClientRect();
    const timelineBounds = documentToTest.querySelector(".timeline-panel").getBoundingClientRect();
    assert(
      counterBounds.bottom <= timelineBounds.top,
      "Le numéro de slide doit rester visible au-dessus de la timeline Monitoring.",
    );

    documentToTest.querySelector("#nextSlideBtn").click();
    await waitFor(
      () => documentToTest.querySelector("#slideCounter").textContent === "Slide 2 / 6",
      "La navigation vers la deuxième slide a échoué.",
    );

    documentToTest.querySelector("#pauseBtn").click();
    assert(!documentToTest.querySelector("#resumeBtn").disabled, "La reprise devrait être disponible après la pause.");
    const persistedProject = JSON.parse(documentToTest.defaultView.localStorage.getItem(STORAGE_KEY));
    assert(!Object.hasOwn(persistedProject, "presentation"), "La session ne doit pas être sauvegardée avec le projet.");
    documentToTest.querySelector("#resumeBtn").click();
    documentToTest.querySelector("#exitPresentationBtn").click();
    await waitFor(
      () => documentToTest.querySelector("#configView").classList.contains("active"),
      "Le retour à la configuration a échoué.",
    );
  } finally {
    if (previousState === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, previousState);
    }
    await loadApplication();
  }
});

test("Crée les types de créneaux et une séquence interactive avec le wizard", async () => {
  const previousState = localStorage.getItem(STORAGE_KEY);
  try {
    localStorage.removeItem(STORAGE_KEY);
    let documentToTest = await loadApplication();
    await importFixture(documentToTest);
    documentToTest.querySelector("#addSlotBtn").click();
    chooseWizardType(documentToTest, "question");
    assert(documentToTest.querySelector("#slotWizardCreateBtn").disabled, "La création doit être bloquée sans slide libre.");
    assert(documentToTest.querySelector("#slotWizardDetailsError").textContent.includes("slides libres"), "Le manque de slides doit être expliqué.");
    documentToTest.querySelector("#closeSlotWizardBtn").click();
    changeInput(documentToTest, '[data-field="endSlide"]', "1");
    const initialSlot = storedSlots(documentToTest)[0];

    documentToTest.querySelector("#addSlotBtn").click();
    assert(documentToTest.querySelector("#slotWizardDialog").open, "Le wizard devrait s'ouvrir.");
    chooseWizardType(documentToTest, "question");
    assert(documentToTest.querySelector("#slotWizardEndSlide").value === "2", "La question doit commencer à la slide suivante.");
    assert(documentToTest.querySelector("#slotWizardDuration").value === "1", "La durée par défaut doit être une minute.");
    documentToTest.querySelector("#slotWizardCreateBtn").click();
    let slots = storedSlots(documentToTest);
    equal(slots.length, 2);
    equal(slots[1].type, "question");
    equal(slots[1].optional, false);
    equal(slots[1].startSlide, 2);
    equal(slots[1].endSlide, 2);
    equal(slots[1].durationMinutes, 1);

    documentToTest.querySelector("#addSlotBtn").click();
    chooseWizardType(documentToTest, "quiz");
    documentToTest.querySelector("#slotWizardCreateBtn").click();
    slots = storedSlots(documentToTest);
    equal(slots[2].type, "quiz");
    equal(slots[2].optional, false);
    equal(slots[2].startSlide, 3);
    equal(slots[2].endSlide, 3);
    equal(slots[2].durationMinutes, 1);
    assert(typeof slots[2].quiz.id === "string" && slots[2].quiz.id, "Le Quiz doit recevoir un identifiant à sa création.");
    equal(slots[2].quiz.options.map((option) => option.id).join(""), "ABCD");

    const quizSlotId = slots[2].id;
    const quizConfigurationId = slots[2].quiz.id;
    updateInput(documentToTest, `#quiz-question-${quizSlotId}`, "Quelle donnée appartient au projet ?");
    updateInput(documentToTest, `#quiz-option-${quizSlotId}-A`, "ProjectState");
    updateInput(documentToTest, `#quiz-option-${quizSlotId}-B`, "SessionState");
    const correctOption = documentToTest.querySelector(`#quiz-correct-option-${quizSlotId}`);
    assert([...correctOption.options].some((option) => option.text === "A - ProjectState"), "Le choix A doit suivre la proposition renseignée.");
    correctOption.value = "A";
    correctOption.dispatchEvent(new Event("change", { bubbles: true }));
    slots = storedSlots(documentToTest);
    equal(slots[2].quiz.question, "Quelle donnée appartient au projet ?");
    equal(slots[2].quiz.correctOptionId, "A");
    equal(slots[2].quiz.id, quizConfigurationId, "L'identifiant du Quiz doit rester stable.");
    const quizToggle = documentToTest.querySelector(`[data-toggle-quiz-slot="${quizSlotId}"]`);
    quizToggle.click();
    const quizCard = documentToTest.querySelector(`[data-toggle-quiz-slot="${quizSlotId}"]`).closest(".slot-card");
    assert(quizCard.querySelector(".quiz-slot-question").textContent.includes("Quelle donnée appartient au projet ?"), "La question du Quiz doit rester visible lorsque le créneau est replié.");
    assert(quizCard.querySelector(".quiz-configuration").hidden, "Le repli doit masquer les champs de configuration du Quiz.");
    assert(quizCard.querySelector(".quiz-configuration").getBoundingClientRect().height === 0, "Le repli doit également masquer visuellement la configuration du Quiz.");
    quizCard.querySelector(`[data-toggle-quiz-slot="${quizSlotId}"]`).click();
    assert(!documentToTest.querySelector(`[data-quiz-slot-id="${quizSlotId}"]`).hidden, "Le dépliage doit restaurer les champs de configuration du Quiz.");

    documentToTest.querySelector("#addSlotBtn").click();
    chooseWizardType(documentToTest, "presentation");
    documentToTest.querySelector("#slotWizardStructureNextBtn").click();
    documentToTest.querySelector("#slotWizardCreateBtn").click();
    slots = storedSlots(documentToTest);
    equal(slots[3].type, "presentation");
    equal(slots[3].optional, false);

    const optionalSnapshots = slots.map((slot) => ({
      id: slot.id,
      name: slot.name,
      type: slot.type,
      startSlide: slot.startSlide,
      endSlide: slot.endSlide,
      durationMinutes: slot.durationMinutes,
      quizId: slot.quiz?.id,
    }));
    [slots[1], slots[2], slots[3]].forEach((slot) => {
      const optional = documentToTest.querySelector(`#slot-optional-${slot.id}`);
      optional.checked = true;
      optional.dispatchEvent(new Event("change", { bubbles: true }));
    });
    slots = storedSlots(documentToTest);
    equal(slots[1].optional, true);
    equal(slots[2].optional, true);
    equal(slots[3].optional, true);
    slots.forEach((slot, index) => {
      const snapshot = optionalSnapshots[index];
      equal(slot.id, snapshot.id);
      equal(slot.name, snapshot.name);
      equal(slot.type, snapshot.type);
      equal(slot.startSlide, snapshot.startSlide);
      equal(slot.endSlide, snapshot.endSlide);
      equal(slot.durationMinutes, snapshot.durationMinutes);
      equal(slot.quiz?.id, snapshot.quizId);
    });
    const questionOptional = documentToTest.querySelector(`#slot-optional-${slots[1].id}`);
    questionOptional.checked = false;
    questionOptional.dispatchEvent(new Event("change", { bubbles: true }));
    equal(storedSlots(documentToTest)[1].optional, false);

    localStorage.removeItem(STORAGE_KEY);
    documentToTest = await loadApplication();
    await importFixture(documentToTest);
    changeInput(documentToTest, '[data-field="endSlide"]', "1");
    const interactiveInitialSlot = storedSlots(documentToTest)[0];
    documentToTest.querySelector("#addSlotBtn").click();
    chooseWizardType(documentToTest, "presentation");
    const interactive = documentToTest.querySelector('input[name="slotWizardStructure"][value="interactive"]');
    interactive.checked = true;
    interactive.dispatchEvent(new Event("change", { bubbles: true }));
    documentToTest.querySelector("#slotWizardStructureNextBtn").click();
    updateInput(documentToTest, "#slotWizardEndSlide", "3");
    updateInput(documentToTest, "#slotWizardDuration", "2");
    const preview = documentToTest.querySelector("#slotWizardPreview").textContent;
    assert(preview.includes("4 → 4") && preview.includes("5 → 5"), "La prévisualisation doit suivre le dernier slide saisi.");
    assert(preview.includes("Total : 4 min"), "La prévisualisation doit recalculer la durée totale.");
    documentToTest.querySelector("#slotWizardCreateBtn").click();
    slots = storedSlots(documentToTest);
    equal(slots.length, 4);
    equal(slots[0].id, interactiveInitialSlot.id);
    equal(slots[0].endSlide, 1);
    equal(slots[1].type, "presentation");
    equal(slots[1].startSlide, 2);
    equal(slots[1].endSlide, 3);
    equal(slots[1].durationMinutes, 2);
    equal(slots[2].type, "question");
    equal(slots[2].startSlide, 4);
    equal(slots[2].endSlide, 4);
    equal(slots[2].durationMinutes, 1);
    equal(slots[3].type, "quiz");
    equal(slots[3].startSlide, 5);
    equal(slots[3].endSlide, 5);
    equal(slots[3].durationMinutes, 1);
    assert(typeof slots[3].quiz.id === "string" && slots[3].quiz.id, "Le Quiz créé par une séquence interactive doit être initialisé.");
    assert(documentToTest.querySelector("#validationList").textContent.includes("Slides non couvertes: 6"), "La validation de couverture existante doit rester active.");
  } finally {
    if (previousState === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, previousState);
    }
    await loadApplication();
  }
});

test("Navigue depuis Monitoring avec une session locale", async () => {
  const previousSession = localStorage.getItem(LOCAL_SESSION_KEY);
  let monitoringFrame = null;
  try {
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({
      project: {
        pageCount: 3,
        slots: [
          {
            id: "slot-1",
            name: "Présentation",
            type: "presentation",
            startSlide: 1,
            endSlide: 1,
            durationMinutes: 1,
            optional: false,
          },
          {
            id: "slot-2",
            name: "Questions optionnelles",
            type: "question",
            startSlide: 2,
            endSlide: 2,
            durationMinutes: 1,
            optional: true,
          },
          {
            id: "slot-3",
            name: "Conclusion",
            type: "presentation",
            startSlide: 3,
            endSlide: 3,
            durationMinutes: 1,
            optional: false,
          },
        ],
        plenary: { startTime: "09:00", durationMinutes: 3 },
      },
      session: {
        id: "local-monitoring-session",
        status: "active",
        version: 1,
        isRunning: true,
        isPaused: false,
        currentSlide: 1,
        startedAt: Date.now(),
        pausedAt: null,
        totalPausedMs: 0,
        accruedDebtMs: 0,
        initialDelayMs: 0,
        initialAdvanceMs: 0,
        slotOverrunsMs: {},
        slotReductionsMs: {},
        slotStartedElapsedMs: { "slot-1": 0 },
        skippedSlotIds: ["slot-2"],
        overrunStrategy: "next",
      },
    }));
    monitoringFrame = await loadMonitoringApplication();
    const monitoringDocument = monitoringFrame.contentDocument;
    await waitFor(
      () => monitoringDocument.querySelector("#slideCounter").textContent === "Slide 1 / 3",
      "Monitoring n'a pas restauré la session locale.",
    );
    await waitFor(
      () => monitoringDocument.querySelectorAll("#timelineTrack .timeline-slot").length === 2,
      "Monitoring doit retirer le créneau ignoré de sa timeline active.",
    );
    assert(
      !monitoringDocument.querySelector("#timelineTrack").textContent.includes("Questions optionnelles"),
      "Le créneau retiré ne doit plus être affiché dans Monitoring.",
    );
    monitoringDocument.querySelector("#nextSlideBtn").click();
    await waitFor(
      () => monitoringDocument.querySelector("#slideCounter").textContent === "Slide 3 / 3",
      "Le bouton Suivante de Monitoring doit ignorer le créneau retiré.",
    );
    const savedSession = JSON.parse(monitoringFrame.contentWindow.localStorage.getItem(LOCAL_SESSION_KEY));
    equal(savedSession.project.slots.length, 3);
    equal(savedSession.project.slots[1].name, "Questions optionnelles");
    equal(savedSession.session.skippedSlotIds.join(","), "slot-2");
    monitoringFrame.remove();
    monitoringFrame = await loadMonitoringApplication();
    const reloadedDocument = monitoringFrame.contentDocument;
    await waitFor(
      () => reloadedDocument.querySelector("#slideCounter").textContent === "Slide 3 / 3",
      "Le rechargement doit restaurer la session adaptée.",
    );
    assert(
      !reloadedDocument.querySelector("#timelineTrack").textContent.includes("Questions optionnelles"),
      "Le rechargement doit conserver la timeline active adaptée.",
    );
    reloadedDocument.querySelector("#exitPresentationBtn").click();
    await waitFor(
      () => reloadedDocument.querySelector("#configView").classList.contains("active"),
      "Quitter doit ramener Monitoring à la configuration.",
    );
    assert(
      !reloadedDocument.querySelector("#presentationView").classList.contains("active"),
      "Quitter doit fermer la vue Monitoring.",
    );
    assert(
      !monitoringFrame.contentWindow.location.search.includes("view=monitoring"),
      "Quitter doit retirer le mode Monitoring de l'URL.",
    );
    const retainedSession = JSON.parse(monitoringFrame.contentWindow.localStorage.getItem(LOCAL_SESSION_KEY));
    assert(
      retainedSession?.session?.isRunning && !retainedSession.session.isPaused,
      "Quitter Monitoring ne doit ni arrêter ni supprimer la session locale active.",
    );
  } finally {
    monitoringFrame?.remove();
    if (previousSession === null) {
      localStorage.removeItem(LOCAL_SESSION_KEY);
    } else {
      localStorage.setItem(LOCAL_SESSION_KEY, previousSession);
    }
  }
});

test("Recommande une récupération sans l'appliquer automatiquement", async () => {
  const previousSession = localStorage.getItem(LOCAL_SESSION_KEY);
  let monitoringFrame = null;
  try {
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({
      project: {
        pageCount: 4,
        slots: [
          { id: "opening", name: "Ouverture", type: "presentation", startSlide: 1, endSlide: 1, durationMinutes: 1, optional: false },
          { id: "question", name: "Questions", type: "question", startSlide: 2, endSlide: 2, durationMinutes: 2, optional: true },
          { id: "quiz", name: "Quiz", type: "quiz", startSlide: 3, endSlide: 3, durationMinutes: 3, optional: true },
          { id: "closing", name: "Conclusion", type: "presentation", startSlide: 4, endSlide: 4, durationMinutes: 1, optional: false },
        ],
        plenary: { startTime: "09:00", durationMinutes: 7 },
      },
      session: {
        id: "local-recovery-session",
        status: "active",
        version: 1,
        isRunning: true,
        isPaused: false,
        currentSlide: 1,
        startedAt: Date.now() - 240000,
        pausedAt: null,
        totalPausedMs: 0,
        accruedDebtMs: 0,
        initialDelayMs: 0,
        initialAdvanceMs: 0,
        slotOverrunsMs: {},
        slotReductionsMs: {},
        slotStartedElapsedMs: { opening: 0 },
        skippedSlotIds: [],
        overrunStrategy: "next",
      },
    }));
    monitoringFrame = await loadMonitoringApplication();
    let monitoringDocument = monitoringFrame.contentDocument;
    await waitFor(
      () => !monitoringDocument.querySelector("#recoveryPanel").hidden,
      "La recommandation doit apparaître lorsque la session est en retard.",
    );
    assert(monitoringDocument.querySelector("#recoveryRecommendation").textContent.includes("05:00"), "Le temps récupérable doit inclure les deux créneaux futurs.");
    assert(monitoringDocument.querySelector("#recoveryRecommendation").textContent.includes("Questions + Quiz"), "La suggestion doit proposer la combinaison minimale disponible.");
    assert([...monitoringDocument.querySelectorAll("#recoverySlots input")].every((input) => !input.checked), "La suggestion ne doit sélectionner aucun créneau automatiquement.");

    const question = monitoringDocument.querySelector('#recoverySlots input[value="question"]');
    question.checked = true;
    question.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(
      () => monitoringDocument.querySelector("#recoverySummary").textContent.includes("Récupération : 02:00")
        && monitoringDocument.querySelector("#recoverySummary").textContent.includes("Retard restant : 02:00"),
      "La sélection manuelle doit recalculer la récupération et le retard restant.",
    );
    monitoringDocument.querySelector("#skipRecoverySlotsBtn").click();
    await waitFor(
      () => monitoringDocument.querySelectorAll("#timelineTrack .timeline-slot").length === 3,
      "La confirmation doit retirer le créneau sélectionné de la timeline active.",
    );
    const saved = JSON.parse(monitoringFrame.contentWindow.localStorage.getItem(LOCAL_SESSION_KEY));
    equal(saved.session.skippedSlotIds.join(","), "question");
    equal(saved.project.slots.length, 4);
    equal(saved.project.slots[1].name, "Questions");
    monitoringFrame.remove();
    monitoringFrame = await loadMonitoringApplication();
    monitoringDocument = monitoringFrame.contentDocument;
    await waitFor(
      () => monitoringDocument.querySelectorAll("#timelineTrack .timeline-slot").length === 3,
      "Le rechargement doit conserver la timeline adaptée.",
    );
  } finally {
    monitoringFrame?.remove();
    if (previousSession === null) {
      localStorage.removeItem(LOCAL_SESSION_KEY);
    } else {
      localStorage.setItem(LOCAL_SESSION_KEY, previousSession);
    }
  }
});

test("Ouvre Monitoring et synchronise sa navigation avec Présentation", async () => {
  const previousState = localStorage.getItem(STORAGE_KEY);
  const previousSession = localStorage.getItem(LOCAL_SESSION_KEY);
  let monitoringFrame = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LOCAL_SESSION_KEY);
    const presentationDocument = await loadApplication();
    await importFixture(presentationDocument);
    updateInput(presentationDocument, "#plenaryStart", "09:00");
    updateInput(presentationDocument, "#plenaryDurationInput", "30");

    let monitoringUrl = "";
    const presentationWindow = presentationDocument.defaultView;
    presentationWindow.open = (url) => {
      monitoringUrl = url;
      return {
        close() {},
        location: { replace(nextUrl) { monitoringUrl = nextUrl; } },
      };
    };

    presentationDocument.querySelector("#startPresentationBtn").click();
    presentationDocument.querySelector('#strategyDialog button[value="confirm"]').click();
    await waitFor(
      () => presentationDocument.querySelector("#presentationView").classList.contains("active"),
      "La vue Présentation ne s'est pas lancée.",
    );
    assert(
      new URL(monitoringUrl).searchParams.get("view") === "monitoring",
      "Le clic de démarrage doit ouvrir un nouvel onglet Monitoring.",
    );

    monitoringFrame = await loadApplicationAt(monitoringUrl);
    const monitoringDocument = monitoringFrame.contentDocument;
    await waitFor(
      () => monitoringDocument.querySelector("#slideCounter").textContent === "Slide 1 / 6",
      "Monitoring n'a pas restauré l'état créé par Présentation.",
    );
    monitoringDocument.querySelector("#nextSlideBtn").click();
    await waitFor(
      () => monitoringDocument.querySelector("#slideCounter").textContent === "Slide 2 / 6",
      "Monitoring n'a pas appliqué sa commande Suivante.",
    );
    await waitFor(
      () => presentationDocument.querySelector("#slideCounter").textContent === "Slide 2 / 6",
      "Présentation n'a pas reçu la navigation depuis Monitoring.",
    );
    presentationDocument.querySelector("#nextSlideBtn").click();
    await waitFor(
      () => monitoringDocument.querySelector("#slideCounter").textContent === "Slide 3 / 6",
      "Monitoring n'a pas reçu la navigation depuis Présentation.",
    );
  } finally {
    monitoringFrame?.remove();
    if (previousState === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, previousState);
    }
    if (previousSession === null) {
      localStorage.removeItem(LOCAL_SESSION_KEY);
    } else {
      localStorage.setItem(LOCAL_SESSION_KEY, previousSession);
    }
    await loadApplication();
  }
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
  : `${outcomes.length} test${outcomes.length > 1 ? "s" : ""} réussi${outcomes.length > 1 ? "s" : ""}.`;