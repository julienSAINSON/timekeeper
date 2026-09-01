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
  applicationFrame.src = "../index.html";
  await loaded;
  await waitFor(
    () => applicationFrame.contentDocument?.querySelector("#configView.active"),
    "L'application ne s'est pas initialisée.",
  );
  return applicationFrame.contentDocument;
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

    documentToTest.querySelector("#nextSlideBtn").click();
    await waitFor(
      () => documentToTest.querySelector("#slideCounter").textContent === "Slide 2 / 6",
      "La navigation vers la deuxième slide a échoué.",
    );

    documentToTest.querySelector("#pauseBtn").click();
    assert(!documentToTest.querySelector("#resumeBtn").disabled, "La reprise devrait être disponible après la pause.");
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