import {
  createSlot,
  loadState,
  resetState,
  saveState,
  validatePlenary,
  validateSlots,
} from "./config.js";
import { getPdfDocument, loadPdfDocument, renderPage } from "./pdfViewer.js";
import {
  formatClock,
  formatHour,
  getCurrentSlot,
  getElapsedMs,
  getSlotStatus,
  getSlotTiming,
} from "./timer.js";
import { renderTimeline } from "./timeline.js";

const state = loadState();
let tickHandle = null;
let currentPdfBuffer = null;

const elements = {
  configView: document.querySelector("#configView"),
  presentationView: document.querySelector("#presentationView"),
  pdfInput: document.querySelector("#pdfInput"),
  pdfName: document.querySelector("#pdfName"),
  pageCount: document.querySelector("#pageCount"),
  plenaryStart: document.querySelector("#plenaryStart"),
  plenaryEnd: document.querySelector("#plenaryEnd"),
  plenaryDuration: document.querySelector("#plenaryDuration"),
  unallocatedDuration: document.querySelector("#unallocatedDuration"),
  plenaryValidation: document.querySelector("#plenaryValidation"),
  totalDuration: document.querySelector("#totalDuration"),
  coverageSummary: document.querySelector("#coverageSummary"),
  validationList: document.querySelector("#validationList"),
  slotsList: document.querySelector("#slotsList"),
  startPresentationBtn: document.querySelector("#startPresentationBtn"),
  addSlotBtn: document.querySelector("#addSlotBtn"),
  clearConfigBtn: document.querySelector("#clearConfigBtn"),
  storageStatus: document.querySelector("#storageStatus"),
  importProgress: document.querySelector("#importProgress"),
  progressLabel: document.querySelector("#progressLabel"),
  progressValue: document.querySelector("#progressValue"),
  progressFill: document.querySelector("#progressFill"),
  pdfCanvas: document.querySelector("#pdfCanvas"),
  pdfStage: document.querySelector("#pdfStage"),
  pdfLoading: document.querySelector("#pdfLoading"),
  slideCounter: document.querySelector("#slideCounter"),
  presentationDetails: document.querySelector("#presentationDetails"),
  togglePresentationDetails: document.querySelector("#togglePresentationDetails"),
  prevSlideBtn: document.querySelector("#prevSlideBtn"),
  nextSlideBtn: document.querySelector("#nextSlideBtn"),
  pauseBtn: document.querySelector("#pauseBtn"),
  resumeBtn: document.querySelector("#resumeBtn"),
  fullscreenBtn: document.querySelector("#fullscreenBtn"),
  exitPresentationBtn: document.querySelector("#exitPresentationBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  globalTimer: document.querySelector("#globalTimer"),
  currentSlotName: document.querySelector("#currentSlotName"),
  slotTimer: document.querySelector("#slotTimer"),
  slotStatusText: document.querySelector("#slotStatusText"),
  timeDebt: document.querySelector("#timeDebt"),
  debtBadge: document.querySelector("#debtBadge"),
  estimatedEnd: document.querySelector("#estimatedEnd"),
  timelineTrack: document.querySelector("#timelineTrack"),
  nowMarker: document.querySelector("#nowMarker"),
  plannedStartLabel: document.querySelector("#plannedStartLabel"),
  plannedEndLabel: document.querySelector("#plannedEndLabel"),
  pdfPreviewState: document.querySelector("#pdfPreviewState"),
};

function persist() {
  saveState(state);
}

function setImportProgress(percent, label) {
  const safePercent = Math.max(0, Math.min(100, percent));
  elements.importProgress.classList.remove("hidden");
  elements.progressFill.style.width = `${safePercent}%`;
  elements.progressValue.textContent = `${safePercent} %`;
  elements.progressLabel.textContent = label;
}

function hideImportProgress() {
  elements.importProgress.classList.add("hidden");
  elements.progressFill.style.width = "0%";
  elements.progressValue.textContent = "0 %";
  elements.progressLabel.textContent = "Preparation de l'import...";
}

async function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        const ratio = Math.min(event.loaded / event.total, 1);
        setImportProgress(10 + Math.round(ratio * 55), "Lecture du fichier PDF...");
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderSlots() {
  elements.slotsList.innerHTML = "";

  if (state.slots.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Ajoutez au moins un creneau pour couvrir la presentation.";
    elements.slotsList.appendChild(empty);
    return;
  }

  state.slots.forEach((slot, index) => {
    const article = document.createElement("article");
    article.className = "slot-card";
    article.innerHTML = `
      <div class="slot-grid">
        <div class="field">
          <label for="slot-name-${slot.id}">Nom</label>
          <input id="slot-name-${slot.id}" type="text" value="${escapeHtml(slot.name)}" data-slot-id="${slot.id}" data-field="name" />
        </div>
        <div class="field">
          <label for="slot-start-${slot.id}">Premiere slide</label>
          <input id="slot-start-${slot.id}" type="number" min="1" value="${slot.startSlide}" data-slot-id="${slot.id}" data-field="startSlide" />
        </div>
        <div class="field">
          <label for="slot-end-${slot.id}">Derniere slide</label>
          <input id="slot-end-${slot.id}" type="number" min="1" value="${slot.endSlide}" data-slot-id="${slot.id}" data-field="endSlide" />
        </div>
        <div class="field">
          <label for="slot-duration-${slot.id}">Duree (min)</label>
          <input id="slot-duration-${slot.id}" type="number" min="1" value="${slot.durationMinutes}" data-slot-id="${slot.id}" data-field="durationMinutes" />
        </div>
        <div class="slot-actions">
          <button type="button" class="ghost-button" data-move="up" data-slot-id="${slot.id}" ${index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="ghost-button" data-move="down" data-slot-id="${slot.id}" ${index === state.slots.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="danger-button" data-remove="${slot.id}">Supprimer</button>
        </div>
      </div>
    `;
    elements.slotsList.appendChild(article);
  });
}

function renderValidation() {
  const summary = validateSlots(state.slots, state.pageCount);
  const plenarySummary = validatePlenary(state.plenary, state.slots);
  elements.totalDuration.textContent = `${summary.totalDurationMinutes} min`;
  elements.coverageSummary.textContent = `${summary.coveredSlides} / ${state.pageCount}`;
  elements.plenaryDuration.textContent = `${plenarySummary.durationMinutes || "--"} min`;
  elements.unallocatedDuration.textContent = `${
    plenarySummary.isValid ? plenarySummary.unallocatedMinutes : "--"
  } min`;
  elements.startPresentationBtn.disabled = !summary.isValid || !plenarySummary.isValid || !currentPdfBuffer;
  elements.validationList.innerHTML = "";
  elements.plenaryValidation.innerHTML = "";

  const plenaryItem = document.createElement("div");
  plenaryItem.className = `validation-item ${plenarySummary.isValid ? "ok" : "error"}`;
  plenaryItem.textContent = plenarySummary.message;
  elements.plenaryValidation.appendChild(plenaryItem);

  summary.issues.forEach((issue) => {
    const item = document.createElement("div");
    item.className = `validation-item ${issue.level}`;
    item.textContent = issue.message;
    elements.validationList.appendChild(item);
  });
}

function renderConfiguration() {
  elements.pdfName.textContent = state.pdfName || "Aucun PDF importe";
  elements.pageCount.textContent = String(state.pageCount || 0);
  elements.plenaryStart.value = state.plenary.startTime;
  elements.plenaryEnd.value = state.plenary.endTime;

  if (state.pdfName && currentPdfBuffer) {
    elements.pdfPreviewState.textContent = "PDF pret pour la presentation.";
  } else if (state.pdfName) {
    elements.pdfPreviewState.textContent =
      "Configuration restauree. Reimportez le PDF pour lancer la presentation.";
  } else {
    elements.pdfPreviewState.textContent = "Le rendu du PDF sera disponible en mode presentation.";
  }

  renderSlots();
  renderValidation();
}

function updatePlenary(field, value) {
  state.plenary[field] = value;
  persist();
  renderValidation();
}

function updateSlot(slotId, field, value, skipFullRender = false) {
  const slot = state.slots.find((item) => item.id === slotId);
  if (!slot) {
    return;
  }

  if (field === "name") {
    slot[field] = value;
  } else if (value === "") {
    slot[field] = "";
  } else {
    slot[field] = Number(value);
  }

  persist();
  if (skipFullRender) {
    renderValidation();
  } else {
    renderConfiguration();
  }
}

function createSequentialSlot() {
  const previousSlot = state.slots.at(-1);
  const maxSlide = Math.max(state.pageCount, 1);
  const nextStartSlide = previousSlot
    ? Math.min(Number(previousSlot.endSlide || 0) + 1, maxSlide)
    : 1;

  const slot = createSlot(state.pageCount);
  slot.startSlide = nextStartSlide;
  slot.endSlide = nextStartSlide;
  slot.name = state.slots.length === 0 ? slot.name : `Créneau ${state.slots.length + 1}`;
  return slot;
}

function moveSlot(slotId, direction) {
  const index = state.slots.findIndex((slot) => slot.id === slotId);
  if (index < 0) {
    return;
  }

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= state.slots.length) {
    return;
  }

  const [slot] = state.slots.splice(index, 1);
  state.slots.splice(targetIndex, 0, slot);
  persist();
  renderConfiguration();
}

function switchView(isPresentation) {
  elements.configView.classList.toggle("active", !isPresentation);
  elements.presentationView.classList.toggle("active", isPresentation);
  document.body.classList.toggle("is-presenting", isPresentation);
}

function setPresentationDetailsCollapsed(isCollapsed) {
  elements.presentationDetails.hidden = isCollapsed;
  elements.presentationView.classList.toggle("presentation-details-open", !isCollapsed);
  elements.togglePresentationDetails.setAttribute("aria-expanded", String(!isCollapsed));
  elements.togglePresentationDetails.setAttribute(
    "aria-label",
    isCollapsed ? "Afficher les informations de présentation" : "Masquer les informations de présentation",
  );
  elements.togglePresentationDetails.title = elements.togglePresentationDetails.getAttribute("aria-label");
  elements.togglePresentationDetails.textContent = isCollapsed ? "▲" : "▼";
}

function waitForNextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

async function ensurePdfLoaded() {
  if (!currentPdfBuffer) {
    return null;
  }

  const currentDocument = getPdfDocument();
  if (currentDocument) {
    return currentDocument;
  }

  elements.pdfLoading.hidden = false;
  const pdf = await loadPdfDocument({ data: currentPdfBuffer });
  elements.pdfLoading.hidden = true;
  return pdf;
}

async function renderCurrentSlide() {
  if (!currentPdfBuffer) {
    return;
  }

  elements.slideCounter.textContent = `Slide ${state.presentation.currentSlide} / ${state.pageCount}`;
  elements.pdfLoading.hidden = false;
  try {
    await renderPage(
      state.presentation.currentSlide,
      elements.pdfCanvas,
      elements.pdfStage.clientWidth,
      elements.pdfStage.clientHeight,
    );
  } finally {
    elements.pdfLoading.hidden = true;
  }
}

function getPresentationSummary() {
  const slotTimings = getSlotTiming(state.slots);
  const plenarySummary = validatePlenary(state.plenary, state.slots);
  const totalPlannedMs = plenarySummary.durationMinutes * 60 * 1000;
  const elapsedMs = getElapsedMs(state.presentation);
  const inheritedSlotOverrunMs = Math.max(
    0,
    state.presentation.accruedDebtMs - state.presentation.initialDelayMs,
  );
  const currentSlot = getCurrentSlot(slotTimings, state.presentation.currentSlide);
  const slotStatus = getSlotStatus(
    currentSlot,
    elapsedMs,
    state.presentation.currentSlide,
    inheritedSlotOverrunMs,
  );
  const totalDebtMs = state.presentation.accruedDebtMs + slotStatus.overrunMs;
  const plannedEnd = new Date();
  const [endHours, endMinutes] = state.plenary.endTime.split(":").map(Number);
  plannedEnd.setHours(endHours, endMinutes, 0, 0);
  const estimatedEnd = new Date(plannedEnd.getTime() + totalDebtMs);
  const scheduleExtended =
    totalDebtMs >= plenarySummary.unallocatedMinutes * 60 * 1000 && totalDebtMs > 0;

  return {
    slotTimings,
    totalPlannedMs,
    elapsedMs,
    currentSlot,
    slotStatus,
    totalDebtMs,
    initialDelayMs: state.presentation.initialDelayMs,
    inheritedSlotOverrunMs,
    slotOverrunsMs: state.presentation.slotOverrunsMs,
    unallocatedDurationMs: plenarySummary.unallocatedMinutes * 60 * 1000,
    plannedEnd,
    estimatedEnd,
    scheduleExtended,
  };
}

function renderPresentationMetrics() {
  const {
    slotTimings,
    totalPlannedMs,
    elapsedMs,
    currentSlot,
    slotStatus,
    totalDebtMs,
    initialDelayMs,
    inheritedSlotOverrunMs,
    slotOverrunsMs,
    unallocatedDurationMs,
    plannedEnd,
    estimatedEnd,
    scheduleExtended,
  } = getPresentationSummary();

  elements.globalTimer.textContent = `${formatClock(elapsedMs)} / ${formatClock(totalPlannedMs)}`;
  elements.currentSlotName.textContent = currentSlot?.name ?? "Hors plan";
  elements.slotTimer.textContent = `${formatClock(slotStatus.slotElapsedMs)} / ${formatClock(
    currentSlot?.durationMs ?? 0,
  )}`;
  elements.slotStatusText.textContent = slotStatus.label;
  elements.timeDebt.textContent = `+${formatClock(totalDebtMs)}`;
  elements.estimatedEnd.textContent =
    plannedEnd && estimatedEnd
      ? scheduleExtended
        ? formatHour(estimatedEnd)
        : `${formatHour(plannedEnd)} -> ${formatHour(estimatedEnd)}`
      : "--:--";
  elements.estimatedEnd.parentElement.classList.toggle("schedule-extended", scheduleExtended);

  elements.debtBadge.classList.remove("status-ok", "status-warning", "status-danger");
  elements.debtBadge.classList.add(`status-${slotStatus.tone}`);

  elements.plannedStartLabel.textContent = state.plenary.startTime;
  elements.plannedEndLabel.textContent = scheduleExtended
    ? formatHour(estimatedEnd)
    : state.plenary.endTime;
  elements.plannedEndLabel.classList.toggle("timeline-end-extended", scheduleExtended);

  renderTimeline(
    elements.timelineTrack,
    elements.nowMarker,
    slotTimings,
    elapsedMs,
    state.presentation.currentSlide,
    inheritedSlotOverrunMs,
    initialDelayMs,
    slotOverrunsMs,
    slotStatus.overrunMs,
    totalPlannedMs,
    unallocatedDurationMs,
  );
}

function startTicking() {
  stopTicking();
  tickHandle = window.setInterval(() => {
    renderPresentationMetrics();
  }, 250);
}

function stopTicking() {
  if (tickHandle) {
    window.clearInterval(tickHandle);
    tickHandle = null;
  }
}

function captureCompletedSlotDebt(previousSlide, nextSlide) {
  const slotTimings = getSlotTiming(state.slots);
  const previousSlot = getCurrentSlot(slotTimings, previousSlide);
  const nextSlot = getCurrentSlot(slotTimings, nextSlide);

  if (!previousSlot || previousSlot.id === nextSlot?.id) {
    return;
  }

  const elapsedMs = getElapsedMs(state.presentation);
  const priorSlotOverrunMs = Math.max(
    0,
    state.presentation.accruedDebtMs - state.presentation.initialDelayMs,
  );
  const lateMs = Math.max(0, elapsedMs - previousSlot.endOffsetMs - priorSlotOverrunMs);
  state.presentation.slotOverrunsMs[previousSlot.id] = lateMs;
  state.presentation.accruedDebtMs += lateMs;
}

async function enterPresentationMode() {
  await ensurePdfLoaded();

  if (!state.presentation.startedAt) {
    const plannedStart = new Date();
    const [startHours, startMinutes] = state.plenary.startTime.split(":").map(Number);
    plannedStart.setHours(startHours, startMinutes, 0, 0);
    state.presentation.initialDelayMs = Math.max(0, Date.now() - plannedStart.getTime());
    state.presentation.accruedDebtMs = state.presentation.initialDelayMs;
  }

  if (state.presentation.isPaused && state.presentation.pausedAt) {
    state.presentation.totalPausedMs += Date.now() - state.presentation.pausedAt;
  }
  state.presentation.isRunning = true;
  state.presentation.isPaused = false;
  state.presentation.currentSlide = Math.min(state.presentation.currentSlide || 1, state.pageCount);
  state.presentation.startedAt ??= Date.now();
  state.presentation.pausedAt = null;
  state.presentation.totalPausedMs = state.presentation.totalPausedMs || 0;
  elements.pauseBtn.disabled = false;
  elements.resumeBtn.disabled = true;
  persist();
  switchView(true);
  setPresentationDetailsCollapsed(true);
  renderPresentationMetrics();
  await waitForNextFrame();
  await renderCurrentSlide();
  renderPresentationMetrics();
  startTicking();
}

function leavePresentationMode() {
  pausePresentation();
  switchView(false);
  stopTicking();
}

function nextSlide() {
  if (state.presentation.currentSlide >= state.pageCount) {
    return;
  }

  captureCompletedSlotDebt(state.presentation.currentSlide, state.presentation.currentSlide + 1);
  state.presentation.currentSlide += 1;
  persist();
  renderCurrentSlide();
  renderPresentationMetrics();
}

function previousSlide() {
  if (state.presentation.currentSlide <= 1) {
    return;
  }

  state.presentation.currentSlide -= 1;
  persist();
  renderCurrentSlide();
  renderPresentationMetrics();
}

function pausePresentation() {
  if (state.presentation.isPaused || !state.presentation.startedAt) {
    return;
  }

  state.presentation.isPaused = true;
  state.presentation.pausedAt = Date.now();
  elements.pauseBtn.disabled = true;
  elements.resumeBtn.disabled = false;
  persist();
}

function resumePresentation() {
  if (!state.presentation.isPaused || !state.presentation.pausedAt) {
    return;
  }

  state.presentation.totalPausedMs += Date.now() - state.presentation.pausedAt;
  state.presentation.isPaused = false;
  state.presentation.pausedAt = null;
  elements.pauseBtn.disabled = false;
  elements.resumeBtn.disabled = true;
  persist();
}

function resetPresentation() {
  if (!window.confirm("Reinitialiser les chronos et revenir a la slide 1 ?")) {
    return;
  }

  state.presentation = {
    isRunning: false,
    isPaused: false,
    currentSlide: 1,
    startedAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    accruedDebtMs: 0,
    initialDelayMs: 0,
    slotOverrunsMs: {},
  };
  elements.pauseBtn.disabled = false;
  elements.resumeBtn.disabled = true;
  persist();
  renderPresentationMetrics();
  renderCurrentSlide();
}

function clearConfiguration() {
  if (!window.confirm("Effacer le PDF, les creneaux et les chronos sauvegardes ?")) {
    return;
  }

  const freshState = resetState();
  Object.assign(state, freshState);
  currentPdfBuffer = null;
  stopTicking();
  switchView(false);
  renderConfiguration();
}

function isEditableTarget(target) {
  return Boolean(target.closest("input, textarea, select"));
}

async function handlePdfImport(event) {
  const [file] = event.target.files ?? [];
  if (!file) {
    return;
  }

  try {
    elements.storageStatus.textContent = "Analyse du PDF en cours...";
    setImportProgress(5, "Initialisation de l'import...");
    const buffer = await readFileAsArrayBuffer(file);
    currentPdfBuffer = new Uint8Array(buffer);
    state.pdfName = file.name;

    setImportProgress(72, "Analyse du document PDF...");
    const pdf = await loadPdfDocument({ data: currentPdfBuffer });
    state.pageCount = pdf.numPages;
    state.presentation = {
      isRunning: false,
      isPaused: false,
      currentSlide: 1,
      startedAt: null,
      pausedAt: null,
      totalPausedMs: 0,
      accruedDebtMs: 0,
      initialDelayMs: 0,
      slotOverrunsMs: {},
    };

    if (state.slots.length === 0) {
      state.slots.push(createSlot(state.pageCount));
    } else {
      state.slots = state.slots.map((slot) => ({
        ...slot,
        endSlide: Math.min(slot.endSlide, state.pageCount),
        startSlide: Math.min(slot.startSlide, state.pageCount),
      }));
    }

    setImportProgress(94, "Sauvegarde locale de la configuration...");
    persist();
    setImportProgress(100, "Import termine.");
    elements.storageStatus.textContent = "Configuration locale active";
    renderConfiguration();
    window.setTimeout(hideImportProgress, 600);
  } catch (error) {
    currentPdfBuffer = null;
    hideImportProgress();
    throw error;
  }
}

function attachEvents() {
  elements.pdfInput.addEventListener("change", (event) => {
    handlePdfImport(event).catch((error) => {
      console.error(error);
      elements.storageStatus.textContent = "Echec de lecture du PDF";
      window.alert(error.message || "Echec de lecture du PDF.");
    });
  });

  elements.plenaryStart.addEventListener("input", (event) => {
    updatePlenary("startTime", event.target.value);
  });
  elements.plenaryEnd.addEventListener("input", (event) => {
    updatePlenary("endTime", event.target.value);
  });

  elements.addSlotBtn.addEventListener("click", () => {
    state.slots.push(createSequentialSlot());
    persist();
    renderConfiguration();
    const newSlot = state.slots.at(-1);
    const nameInput = document.querySelector(`#slot-name-${newSlot.id}`);
    nameInput?.focus();
    nameInput?.select();
  });

  elements.slotsList.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    updateSlot(target.dataset.slotId, target.dataset.field, target.value, true);
  });

  elements.slotsList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    updateSlot(target.dataset.slotId, target.dataset.field, target.value);
  });

  elements.slotsList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const removeId = target.getAttribute("data-remove");
    if (removeId) {
      state.slots = state.slots.filter((slot) => slot.id !== removeId);
      persist();
      renderConfiguration();
      return;
    }

    const slotId = target.getAttribute("data-slot-id");
    const direction = target.getAttribute("data-move");
    if (slotId && direction) {
      moveSlot(slotId, direction);
    }
  });

  elements.startPresentationBtn.addEventListener("click", () => {
    enterPresentationMode().catch((error) => {
      console.error(error);
      window.alert(
        error.message || "Impossible de démarrer la présentation. Vérifiez le chargement du PDF.",
      );
    });
  });

  elements.prevSlideBtn.addEventListener("click", previousSlide);
  elements.nextSlideBtn.addEventListener("click", nextSlide);
  elements.togglePresentationDetails.addEventListener("click", () => {
    setPresentationDetailsCollapsed(!elements.presentationDetails.hidden);
  });
  elements.pdfStage.addEventListener("click", nextSlide);
  elements.pauseBtn.addEventListener("click", pausePresentation);
  elements.resumeBtn.addEventListener("click", resumePresentation);
  elements.exitPresentationBtn.addEventListener("click", leavePresentationMode);
  elements.resetBtn.addEventListener("click", resetPresentation);
  elements.clearConfigBtn.addEventListener("click", clearConfiguration);
  elements.fullscreenBtn.addEventListener("click", async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  });

  window.addEventListener("resize", () => {
    if (elements.presentationView.classList.contains("active")) {
      renderCurrentSlide().catch(console.error);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (isEditableTarget(event.target)) {
      return;
    }

    if (!elements.presentationView.classList.contains("active")) {
      return;
    }

    if (event.key === "ArrowRight" || event.key === " ") {
      event.preventDefault();
      nextSlide();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      previousSlide();
    } else if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      if (state.presentation.isPaused) {
        resumePresentation();
      } else {
        pausePresentation();
      }
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      elements.fullscreenBtn.click();
    }
  });
}

async function bootstrap() {
  attachEvents();
  renderConfiguration();
  if (state.pdfName) {
    elements.storageStatus.textContent = "Configuration locale active";
  }
}

bootstrap().catch(console.error);
