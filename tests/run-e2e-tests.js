const STORAGE_KEY = "safe-timekeeper-config-v1";
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

    documentToTest.querySelector("#addSlotBtn").click();
    chooseWizardType(documentToTest, "presentation");
    documentToTest.querySelector("#slotWizardStructureNextBtn").click();
    documentToTest.querySelector("#slotWizardCreateBtn").click();
    slots = storedSlots(documentToTest);
    equal(slots[3].type, "presentation");
    equal(slots[3].optional, false);

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

test("Sépare Présentation et Monitoring avec une session locale synchronisée", async () => {
  const previousState = localStorage.getItem(STORAGE_KEY);
  let monitoringFrame = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
    const presentationDocument = await loadApplication();
    await importFixture(presentationDocument);
    updateInput(presentationDocument, "#plenaryStart", "09:00");
    updateInput(presentationDocument, "#plenaryDurationInput", "30");
    presentationDocument.querySelector("#startPresentationBtn").click();
    presentationDocument.querySelector('#strategyDialog button[value="confirm"]').click();
    await waitFor(
      () => presentationDocument.querySelector("#presentationView").classList.contains("active"),
      "La vue Présentation ne s'est pas lancée.",
    );
    assert(
      presentationDocument.defaultView.location.search === "?view=presentation",
      "L'onglet source doit devenir la vue Présentation.",
    );
    const presentationWindow = presentationDocument.defaultView;
    assert(
      presentationWindow.getComputedStyle(presentationDocument.querySelector(".timeline-panel")).display === "none",
      "La timeline ne doit pas être visible dans Présentation.",
    );

    monitoringFrame = await loadMonitoringApplication();
    const monitoringDocument = monitoringFrame.contentDocument;
    await waitFor(
      () => monitoringDocument.querySelector("#globalTimer").textContent !== "00:00 / 00:00",
      "Monitoring n'a pas reçu la session active.",
    );
    assert(
      monitoringDocument.querySelector("#slideCounter").textContent === "Slide 1 / 6",
      "Monitoring doit recevoir le nombre de slides du projet de Présentation.",
    );
    const monitoringWindow = monitoringDocument.defaultView;
    assert(
      monitoringWindow.getComputedStyle(monitoringDocument.querySelector(".timeline-panel")).display !== "none",
      "La timeline doit être visible dans Monitoring.",
    );
    assert(
      monitoringWindow.getComputedStyle(monitoringDocument.querySelector(".presentation-toolbar")).display !== "none",
      "Les contrôles doivent être visibles dans Monitoring.",
    );

    presentationDocument.querySelector("#pdfStage").click();
    await waitFor(
      () => monitoringDocument.querySelector("#slideCounter").textContent === "Slide 2 / 6",
      "Monitoring n'a pas reçu la navigation de Présentation.",
    );
    monitoringDocument.querySelector("#nextSlideBtn").click();
    await waitFor(
      () => presentationDocument.querySelector("#slideCounter").textContent === "Slide 3 / 6",
      "Présentation n'a pas reçu la navigation de Monitoring.",
    );
  } finally {
    monitoringFrame?.remove();
    if (previousState === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, previousState);
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