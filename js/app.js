import {
  createSlot,
  loadState,
  normalizeState,
  resetState,
  saveState,
  getPlenaryEndTime,
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
import {
  createSharedPlenary,
  deleteSharedPlenary,
  forgetProject,
  getKnownProjects,
  loadSharedPlenary,
  rememberProject,
  saveSharedPlenary,
} from "./supabase.js";

const state = loadState();
let tickHandle = null;
let currentPdfBuffer = null;
let hasUnsavedChanges = false;
let sideInfoIdleHandle = null;
let savedProjectName = state.remoteToken ? state.projectName : "";

const elements = {
  configView: document.querySelector("#configView"),
  presentationView: document.querySelector("#presentationView"),
  projectName: document.querySelector("#projectName"),
  pdfInput: document.querySelector("#pdfInput"),
  pdfUploadCard: document.querySelector("#pdfUploadCard"),
  pdfUploadTitle: document.querySelector("#pdfUploadTitle"),
  pdfUploadSubtitle: document.querySelector("#pdfUploadSubtitle"),
  pdfName: document.querySelector("#pdfName"),
  pageCount: document.querySelector("#pageCount"),
  plenaryStart: document.querySelector("#plenaryStart"),
  plenaryDurationInput: document.querySelector("#plenaryDurationInput"),
  plenaryDuration: document.querySelector("#plenaryDuration"),
  unallocatedDuration: document.querySelector("#unallocatedDuration"),
  plenaryValidation: document.querySelector("#plenaryValidation"),
  totalDuration: document.querySelector("#totalDuration"),
  coverageSummary: document.querySelector("#coverageSummary"),
  validationList: document.querySelector("#validationList"),
  slotsList: document.querySelector("#slotsList"),
  startPresentationBtn: document.querySelector("#startPresentationBtn"),
  startPresentationReason: document.querySelector("#startPresentationReason"),
  addSlotBtn: document.querySelector("#addSlotBtn"),
  newProjectBtn: document.querySelector("#newProjectBtn"),
  projectsBtn: document.querySelector("#projectsBtn"),
  projectsDialog: document.querySelector("#projectsDialog"),
  projectSaveDialog: document.querySelector("#projectSaveDialog"),
  strategyDialog: document.querySelector("#strategyDialog"),
  closeProjectsBtn: document.querySelector("#closeProjectsBtn"),
  projectsList: document.querySelector("#projectsList"),
  saveBtn: document.querySelector("#saveBtn"),
  clearConfigBtn: document.querySelector("#clearConfigBtn"),
  storageStatus: document.querySelector("#storageStatus"),
  importProgress: document.querySelector("#importProgress"),
  progressLabel: document.querySelector("#progressLabel"),
  progressValue: document.querySelector("#progressValue"),
  progressFill: document.querySelector("#progressFill"),
  pdfCanvas: document.querySelector("#pdfCanvas"),
  pdfStage: document.querySelector("#pdfStage"),
  sideCurrentSlotPanel: document.querySelector(".slide-side-info-current"),
  sideNextSlotPanel: document.querySelector(".slide-side-info-next"),
  sideCurrentSlotName: document.querySelector("#sideCurrentSlotName"),
  sideCurrentSlotTime: document.querySelector("#sideCurrentSlotTime"),
  sideCurrentSlotStatus: document.querySelector("#sideCurrentSlotStatus"),
  sideNextSlotName: document.querySelector("#sideNextSlotName"),
  sideNextSlotTime: document.querySelector("#sideNextSlotTime"),
  pdfLoading: document.querySelector("#pdfLoading"),
  slideCounter: document.querySelector("#slideCounter"),
  presentationDetails: document.querySelector("#presentationDetails"),
  togglePresentationDetails: document.querySelector("#togglePresentationDetails"),
  prevSlideBtn: document.querySelector("#prevSlideBtn"),
  nextSlideBtn: document.querySelector("#nextSlideBtn"),
  pauseBtn: document.querySelector("#pauseBtn"),
  resumeBtn: document.querySelector("#resumeBtn"),
  fullscreenBtn: document.querySelector("#fullscreenBtn"),
  exportReportBtn: document.querySelector("#exportReportBtn"),
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
  hasUnsavedChanges = true;
  elements.saveBtn.disabled = false;
  elements.storageStatus.textContent = "Modifications non sauvegardées";
}

function updateSaveButton() {
  elements.saveBtn.disabled = !hasUnsavedChanges;
}

function chooseRenamedProjectDestination() {
  return new Promise((resolve) => {
    elements.projectSaveDialog.addEventListener(
      "close",
      () => resolve(elements.projectSaveDialog.returnValue),
      { once: true },
    );
    elements.projectSaveDialog.showModal();
  });
}

function updateFullscreenSideInfoVisibility() {
  window.clearTimeout(sideInfoIdleHandle);
  document.documentElement.classList.remove("side-info-idle");

  if (!document.fullscreenElement) {
    return;
  }

  sideInfoIdleHandle = window.setTimeout(() => {
    document.documentElement.classList.add("side-info-idle");
  }, 2000);
}

function hasProjectContent() {
  return Boolean(
    state.projectName.trim() ||
      state.pdfName ||
      state.slots.length ||
      state.plenary.startTime ||
      state.plenary.durationMinutes,
  );
}

function confirmDiscardUnsavedChanges(action) {
  if (!hasUnsavedChanges || !hasProjectContent()) {
    return true;
  }

  return window.confirm(
    `Des modifications ne sont pas encore sauvegardées. ${action} les fera perdre. Continuer ?`,
  );
}

function renderProjects() {
  const projects = getKnownProjects();
  elements.projectsList.innerHTML = "";

  if (projects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Aucun projet n'a encore été sauvegardé sur ce navigateur.";
    elements.projectsList.appendChild(empty);
    return;
  }

  projects.forEach((project) => {
    const item = document.createElement("article");
    const details = document.createElement("div");
    const name = document.createElement("strong");
    const date = document.createElement("span");
    const actions = document.createElement("div");
    const open = document.createElement("button");
    const remove = document.createElement("button");

    item.className = "project-list-item";
    name.textContent = project.name;
    date.textContent = `Dernière ouverture : ${new Date(project.lastOpenedAt).toLocaleString("fr-FR")}`;
    details.append(name, date);
    open.className = "secondary-button";
    open.type = "button";
    open.dataset.projectToken = project.token;
    open.dataset.action = "open";
    open.textContent = "Ouvrir";
    remove.className = "danger-button";
    remove.type = "button";
    remove.dataset.projectToken = project.token;
    remove.dataset.projectName = project.name;
    remove.dataset.action = "delete";
    remove.textContent = "Supprimer";
    actions.className = "project-list-actions";
    actions.append(open, remove);
    item.append(details, actions);
    elements.projectsList.appendChild(item);
  });
}

async function openProject(token) {
  if (!confirmDiscardUnsavedChanges("Ouvrir un autre projet")) {
    return;
  }

  elements.storageStatus.textContent = "Chargement du projet...";
  const remoteState = await loadSharedPlenary(token);
  if (!remoteState) {
    throw new Error("Ce projet est introuvable.");
  }

  Object.assign(state, normalizeState(remoteState), { remoteToken: token });
  currentPdfBuffer = null;
  elements.pdfInput.value = "";
  stopTicking();
  switchView(false);
  saveState(state);
  rememberProject(token, state.projectName);
  savedProjectName = state.projectName;
  hasUnsavedChanges = false;
  updateSaveButton();
  elements.projectsDialog.close();
  renderConfiguration();
  elements.storageStatus.textContent = "Projet chargé. Réimportez le PDF pour le lancer.";
}

async function deleteProject(token, projectName) {
  if (!window.confirm(`Supprimer définitivement le projet "${projectName}" ?`)) {
    return;
  }

  elements.storageStatus.textContent = "Suppression du projet...";
  await deleteSharedPlenary(token);
  forgetProject(token);
  const hasRemainingProjects = getKnownProjects().length > 0;

  if (state.remoteToken === token) {
    Object.assign(state, resetState());
    delete state.remoteToken;
    savedProjectName = "";
    hasUnsavedChanges = false;
    updateSaveButton();
    currentPdfBuffer = null;
    elements.pdfInput.value = "";
    stopTicking();
    switchView(false);
    window.history.replaceState({}, "", window.location.pathname);
    renderConfiguration();
  } else if (hasRemainingProjects) {
    renderProjects();
  }

  if (!hasRemainingProjects) {
    elements.projectsDialog.close();
  }

  elements.storageStatus.textContent = "Projet supprimé";
}

async function saveProject() {
  if (!state.projectName.trim()) {
    elements.projectName.focus();
    throw new Error("Donnez un nom au projet avant de le sauvegarder.");
  }

  elements.saveBtn.disabled = true;
  elements.storageStatus.textContent = "Sauvegarde du projet...";
  try {
    if (state.remoteToken && state.projectName !== savedProjectName) {
      const destination = await chooseRenamedProjectDestination();
      if (destination === "cancel") {
        elements.storageStatus.textContent = "Sauvegarde annulée";
        return;
      }
      if (destination === "new") {
        state.remoteToken = await createSharedPlenary(state);
      }
    }

    if (!state.remoteToken) {
      state.remoteToken = await createSharedPlenary(state);
    }

    await saveSharedPlenary(state.remoteToken, state);
    saveState(state);
    rememberProject(state.remoteToken, state.projectName);
    savedProjectName = state.projectName;
    hasUnsavedChanges = false;
    elements.storageStatus.textContent = "Projet sauvegardé";
  } finally {
    updateSaveButton();
  }
}

function createNewProject() {
  if (!confirmDiscardUnsavedChanges("Créer un nouveau projet")) {
    return;
  }

  Object.assign(state, resetState());
  delete state.remoteToken;
  savedProjectName = "";
  hasUnsavedChanges = false;
  updateSaveButton();
  currentPdfBuffer = null;
  elements.pdfInput.value = "";
  stopTicking();
  switchView(false);
  window.history.replaceState({}, "", window.location.pathname);
  renderConfiguration();
  elements.storageStatus.textContent = "Nouveau projet prêt à configurer";
  elements.projectName.focus();
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
  const startReason = !currentPdfBuffer
    ? "Importez ou réimportez le PDF pour démarrer la plénière."
    : !plenarySummary.isValid
      ? plenarySummary.message
      : !summary.isValid
        ? "Corrigez les créneaux avant de démarrer la plénière."
        : "";
  elements.startPresentationBtn.disabled = Boolean(startReason);
  elements.startPresentationReason.textContent = startReason;
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
  elements.projectName.value = state.projectName;
  elements.clearConfigBtn.disabled = !state.remoteToken;
  elements.pdfName.textContent = state.pdfName || "Aucun PDF importe";
  elements.pageCount.textContent = String(state.pageCount || 0);
  elements.plenaryStart.value = state.plenary.startTime;
  elements.plenaryDurationInput.value = state.plenary.durationMinutes;
  const isPdfLoaded = Boolean(currentPdfBuffer);
  elements.pdfUploadCard.classList.toggle("pdf-ready", isPdfLoaded);
  elements.pdfUploadCard.classList.toggle("pdf-required", !isPdfLoaded);
  elements.pdfUploadTitle.textContent = isPdfLoaded ? "PDF chargé" : "Importer un PDF";
  elements.pdfUploadSubtitle.textContent = isPdfLoaded
    ? "Cliquez pour remplacer le document chargé."
    : "Le fichier reste dans le navigateur et sera restauré au prochain chargement.";

  if (state.pdfName && isPdfLoaded) {
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
  state.plenary[field] = field === "durationMinutes" && value !== "" ? Number(value) : value;
  state.plenary.endTime = getPlenaryEndTime(state.plenary);
  persist();
  renderValidation();
}

function updateProjectName(value) {
  state.projectName = value;
  persist();
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
  slot.endSlide = maxSlide;
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

  const sidePanelWidth = Math.max(
    elements.sideCurrentSlotPanel.getBoundingClientRect().width,
    elements.sideNextSlotPanel.getBoundingClientRect().width,
  );
  const canvasSideReserve = Math.min(180, Math.max(130, window.innerWidth * 0.12));
  const sideSpace = sidePanelWidth > 0 ? canvasSideReserve : 0;
  const horizontalGutter = sidePanelWidth > 0 ? 32 : 0;
  const availableWidth = Math.max(
    1,
    elements.pdfStage.clientWidth - sideSpace * 2 - horizontalGutter,
  );

  elements.slideCounter.textContent = `Slide ${state.presentation.currentSlide} / ${state.pageCount}`;
  elements.pdfLoading.hidden = false;
  try {
    await renderPage(
      state.presentation.currentSlide,
      elements.pdfCanvas,
      availableWidth,
      elements.pdfStage.clientHeight,
    );
  } finally {
    elements.pdfLoading.hidden = true;
  }
}

function getPresentationSummary() {
  const slotTimings = getSlotTiming(state.slots, state.presentation.slotReductionsMs);
  const plenarySummary = validatePlenary(state.plenary, state.slots);
  const totalPlannedMs = plenarySummary.durationMinutes * 60 * 1000;
  const elapsedMs = getElapsedMs(state.presentation);
  const currentSlot = getCurrentSlot(slotTimings, state.presentation.currentSlide);
  const slotStartedElapsedMs = Number(
    state.presentation.slotStartedElapsedMs[currentSlot?.id] ?? 0,
  );
  const slotStatus = getSlotStatus(
    currentSlot,
    elapsedMs - slotStartedElapsedMs,
    state.presentation.currentSlide,
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
    initialAdvanceMs: state.presentation.initialAdvanceMs,
    inheritedSlotOverrunMs: 0,
    slotOverrunsMs: state.presentation.slotOverrunsMs,
    unallocatedDurationMs: plenarySummary.unallocatedMinutes * 60 * 1000,
    plannedEnd,
    estimatedEnd,
    scheduleExtended,
  };
}

function renderPresentationMetrics() {
  let presentationSummary = getPresentationSummary();
  if (presentationSummary.currentSlot && presentationSummary.slotStatus.overrunMs > 0) {
    applyOverrunStrategy(
      state.slots.findIndex((slot) => slot.id === presentationSummary.currentSlot.id),
      presentationSummary.totalDebtMs,
    );
    presentationSummary = getPresentationSummary();
  }

  const {
    slotTimings,
    totalPlannedMs,
    elapsedMs,
    currentSlot,
    slotStatus,
    totalDebtMs,
    initialDelayMs,
    initialAdvanceMs,
    slotOverrunsMs,
    unallocatedDurationMs,
    plannedEnd,
    estimatedEnd,
    scheduleExtended,
  } = presentationSummary;

  elements.globalTimer.textContent = `${formatClock(elapsedMs)} / ${formatClock(totalPlannedMs)}`;
  elements.currentSlotName.textContent = currentSlot?.name ?? "Hors plan";
  elements.slotTimer.textContent = `${formatClock(slotStatus.slotElapsedMs)} / ${formatClock(
    currentSlot?.durationMs ?? 0,
  )}`;
  elements.slotStatusText.textContent = slotStatus.label;
  const currentSlotIndex = slotTimings.findIndex((slot) => slot.id === currentSlot?.id);
  const nextSlot = currentSlotIndex >= 0 ? slotTimings[currentSlotIndex + 1] : null;
  elements.sideCurrentSlotName.textContent = currentSlot?.name ?? "Hors plan";
  elements.sideCurrentSlotTime.textContent = `${formatClock(slotStatus.slotElapsedMs)} / ${formatClock(
    currentSlot?.durationMs ?? 0,
  )}`;
  elements.sideCurrentSlotStatus.textContent = slotStatus.label;
  elements.sideCurrentSlotPanel.classList.remove("status-ok", "status-warning", "status-danger");
  elements.sideCurrentSlotPanel.classList.add(`status-${slotStatus.tone}`);
  elements.sideNextSlotName.textContent = nextSlot?.name ?? "Fin de la plénière";
  elements.sideNextSlotTime.textContent = nextSlot ? formatClock(nextSlot.durationMs) : "--:--";
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
    totalDebtMs,
    initialDelayMs,
    slotOverrunsMs,
    slotStatus.overrunMs,
    totalPlannedMs,
    unallocatedDurationMs,
    state.presentation.slotReductionsMs,
    slotStatus.slotElapsedMs,
    initialAdvanceMs,
  );
}

function startTicking() {
  stopTicking();
  tickHandle = window.setInterval(() => {
    renderPresentationMetrics();
  }, 250);
}

function escapeCsvValue(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function exportPresentationReport() {
  const presentationSummary = getPresentationSummary();
  const overrunsMs = { ...state.presentation.slotOverrunsMs };
  if (presentationSummary.currentSlot && presentationSummary.slotStatus.overrunMs > 0) {
    overrunsMs[presentationSummary.currentSlot.id] = presentationSummary.slotStatus.overrunMs;
  }

  const rows = [
    ["Nom du créneau", "Temps initial", "Temps de dépassement", "Retard au démarrage de la réunion"],
    ...state.slots.map((slot) => [
      slot.name,
      formatClock(Number(slot.durationMinutes) * 60 * 1000),
      formatClock(Number(overrunsMs[slot.id] || 0)),
      formatClock(state.presentation.initialDelayMs),
    ]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(escapeCsvValue).join(";")).join("\r\n")}`;
  const reportUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const download = document.createElement("a");
  const projectName = state.projectName.trim() || "pleniere";
  download.href = reportUrl;
  download.download = `rapport-${projectName.replaceAll(/[^a-z0-9]+/gi, "-").replaceAll(/^-|-$/g, "")}.csv`;
  download.click();
  URL.revokeObjectURL(reportUrl);
}

function stopTicking() {
  if (tickHandle) {
    window.clearInterval(tickHandle);
    tickHandle = null;
  }
}

function captureCompletedSlotDebt(previousSlide, nextSlide) {
  const slotTimings = getSlotTiming(state.slots, state.presentation.slotReductionsMs);
  const previousSlot = getCurrentSlot(slotTimings, previousSlide);
  const nextSlot = getCurrentSlot(slotTimings, nextSlide);

  if (!previousSlot || previousSlot.id === nextSlot?.id) {
    return;
  }

  const elapsedMs = getElapsedMs(state.presentation);
  const slotStartedElapsedMs = Number(state.presentation.slotStartedElapsedMs[previousSlot.id] ?? 0);
  const lateMs = Math.max(0, elapsedMs - slotStartedElapsedMs - previousSlot.durationMs);
  state.presentation.slotOverrunsMs[previousSlot.id] = lateMs;
  state.presentation.accruedDebtMs += lateMs;
  applyOverrunStrategy(state.slots.findIndex((slot) => slot.id === previousSlot.id));
}

function applyOverrunStrategy(completedSlotIndex, totalDebtMs = state.presentation.accruedDebtMs) {
  if (state.presentation.overrunStrategy === "shift-end") {
    return;
  }

  const plenarySummary = validatePlenary(state.plenary, state.slots);
  const targetReductionMs = Math.max(
    0,
    totalDebtMs - plenarySummary.unallocatedMinutes * 60 * 1000,
  );
  const appliedReductionMs = Object.values(state.presentation.slotReductionsMs).reduce(
    (total, reduction) => total + Number(reduction || 0),
    0,
  );
  let remainingReductionMs = Math.max(0, targetReductionMs - appliedReductionMs);
  let candidates = state.slots.slice(completedSlotIndex + 1);
  const availableReduction = (slot) => Math.max(
    0,
    Number(slot.durationMinutes) * 60 * 1000 - Number(state.presentation.slotReductionsMs[slot.id] || 0) - 1000,
  );

  if (state.presentation.overrunStrategy === "last") {
    candidates = candidates.reverse();
  }

  if (state.presentation.overrunStrategy === "proportional") {
    const availableMs = candidates.reduce((total, slot) => total + availableReduction(slot), 0);
    if (availableMs === 0) {
      return;
    }
    let allocatedReductionMs = 0;
    candidates.forEach((slot, index) => {
      const reduction = Math.min(
        availableReduction(slot),
        index === candidates.length - 1
          ? Math.max(0, remainingReductionMs - allocatedReductionMs)
          : Math.round((remainingReductionMs * availableReduction(slot)) / availableMs),
      );
      state.presentation.slotReductionsMs[slot.id] =
        Number(state.presentation.slotReductionsMs[slot.id] || 0) + reduction;
      allocatedReductionMs += reduction;
    });
    remainingReductionMs -= allocatedReductionMs;
    return;
  }

  candidates.forEach((slot) => {
    const reduction = Math.min(availableReduction(slot), remainingReductionMs);
    state.presentation.slotReductionsMs[slot.id] =
      Number(state.presentation.slotReductionsMs[slot.id] || 0) + reduction;
    remainingReductionMs -= reduction;
  });
}

async function enterPresentationMode() {
  await ensurePdfLoaded();

  if (!state.presentation.startedAt) {
    const plannedStart = new Date();
    const [startHours, startMinutes] = state.plenary.startTime.split(":").map(Number);
    plannedStart.setHours(startHours, startMinutes, 0, 0);
    const startDifferenceMs = Date.now() - plannedStart.getTime();
    state.presentation.initialDelayMs = Math.max(0, startDifferenceMs);
    state.presentation.initialAdvanceMs = Math.max(0, -startDifferenceMs);
    state.presentation.accruedDebtMs = state.presentation.initialDelayMs;
    applyOverrunStrategy(-1, state.presentation.initialDelayMs);
  }

  if (state.presentation.isPaused && state.presentation.pausedAt) {
    state.presentation.totalPausedMs += Date.now() - state.presentation.pausedAt;
  }
  state.presentation.isRunning = true;
  state.presentation.isPaused = false;
  state.presentation.currentSlide = Math.min(state.presentation.currentSlide || 1, state.pageCount);
  state.presentation.startedAt ??= Date.now();
  const initialSlot = getCurrentSlot(
    getSlotTiming(state.slots, state.presentation.slotReductionsMs),
    state.presentation.currentSlide,
  );
  if (initialSlot && state.presentation.slotStartedElapsedMs[initialSlot.id] === undefined) {
    state.presentation.slotStartedElapsedMs[initialSlot.id] = Math.max(
      getElapsedMs(state.presentation),
      state.presentation.initialAdvanceMs,
    );
  }
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
  const nextSlot = getCurrentSlot(
    getSlotTiming(state.slots, state.presentation.slotReductionsMs),
    state.presentation.currentSlide,
  );
  if (nextSlot && state.presentation.slotStartedElapsedMs[nextSlot.id] === undefined) {
    state.presentation.slotStartedElapsedMs[nextSlot.id] = getElapsedMs(state.presentation);
  }
  updateFullscreenSideInfoVisibility();
  persist();
  renderCurrentSlide();
  renderPresentationMetrics();
}

function previousSlide() {
  if (state.presentation.currentSlide <= 1) {
    return;
  }

  state.presentation.currentSlide -= 1;
  updateFullscreenSideInfoVisibility();
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
    initialAdvanceMs: 0,
    slotOverrunsMs: {},
    slotReductionsMs: {},
    slotStartedElapsedMs: {},
    overrunStrategy: "next",
  };
  elements.pauseBtn.disabled = false;
  elements.resumeBtn.disabled = true;
  persist();
  renderPresentationMetrics();
  renderCurrentSlide();
}

function clearConfiguration() {
  if (!confirmDiscardUnsavedChanges("Effacer la configuration")) {
    return;
  }

  const remoteToken = state.remoteToken;
  const freshState = resetState();
  if (remoteToken) {
    freshState.remoteToken = remoteToken;
  }
  Object.assign(state, freshState);
  hasUnsavedChanges = false;
  persist();
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
      initialAdvanceMs: 0,
      slotOverrunsMs: {},
      slotReductionsMs: {},
      slotStartedElapsedMs: {},
      overrunStrategy: "next",
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
  elements.plenaryDurationInput.addEventListener("input", (event) => {
    updatePlenary("durationMinutes", event.target.value);
  });
  elements.projectName.addEventListener("input", (event) => {
    updateProjectName(event.target.value);
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
    elements.strategyDialog.showModal();
  });
  elements.strategyDialog.addEventListener("close", () => {
    if (elements.strategyDialog.returnValue !== "confirm") {
      return;
    }
    const selectedStrategy = document.querySelector('input[name="overrunStrategy"]:checked');
    state.presentation.overrunStrategy = selectedStrategy?.value || "next";
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
  elements.exportReportBtn.addEventListener("click", exportPresentationReport);
  elements.exitPresentationBtn.addEventListener("click", leavePresentationMode);
  elements.resetBtn.addEventListener("click", resetPresentation);
  elements.clearConfigBtn.addEventListener("click", clearConfiguration);
  elements.saveBtn.addEventListener("click", () => {
    saveProject().catch((error) => {
      console.error(error);
      elements.storageStatus.textContent = "Impossible de sauvegarder le projet";
      window.alert(error.message || "Impossible de joindre Supabase.");
    });
  });
  elements.newProjectBtn.addEventListener("click", createNewProject);
  elements.projectsBtn.addEventListener("click", () => {
    renderProjects();
    elements.projectsDialog.showModal();
  });
  elements.closeProjectsBtn.addEventListener("click", () => elements.projectsDialog.close());
  elements.projectsList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.projectToken) {
      return;
    }

    const operation = target.dataset.action === "delete"
      ? deleteProject(target.dataset.projectToken, target.dataset.projectName)
      : openProject(target.dataset.projectToken);
    operation.catch((error) => {
      console.error(error);
      elements.storageStatus.textContent = "Impossible de mettre à jour le projet";
      window.alert(error.message || "Impossible de joindre Supabase.");
    });
  });
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

  document.addEventListener("fullscreenchange", () => {
    updateFullscreenSideInfoVisibility();
    if (document.fullscreenElement) {
      setPresentationDetailsCollapsed(true);
    }
    if (elements.presentationView.classList.contains("active")) {
      renderCurrentSlide().catch(console.error);
    }
  });

  document.addEventListener("mousemove", () => {
    if (document.fullscreenElement) {
      updateFullscreenSideInfoVisibility();
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
  hasUnsavedChanges = false;
  updateSaveButton();
  if (state.remoteToken) {
    elements.storageStatus.textContent = "Projet synchronisé";
  } else if (state.pdfName) {
    elements.storageStatus.textContent = "Configuration locale active";
  }
}

bootstrap().catch(console.error);
