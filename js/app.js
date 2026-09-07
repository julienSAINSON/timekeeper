import {
  createSlot,
  loadState,
  normalizeState,
  resetState,
  saveState,
  getPlenaryEndTime,
  validatePlenary,
  validateSlots,
} from "./config.js?v=quiz-project-config-v1";
import { getPdfDocument, loadPdfDocument, renderPage } from "./pdfViewer.js";
import {
  formatClock,
  formatHour,
  getActiveSessionSlots,
  getCurrentSlot,
  getElapsedMs,
  getFutureOptionalSlots,
  getNextAvailableSlide,
  getRecoveryRecommendation,
  getRecoverySummary,
  getSessionDelayMs,
  getSlotStatus,
  getSlotTiming,
} from "./timer.js?v=recovery-recommendation-v1";
import { createSessionState, normalizeSessionState } from "./session.js?v=optional-slot-recovery-v1";
import {
  generateRoomToken,
  getPublicRoomUrl,
  getRoomTokenFromPath,
} from "./room.js";
import {
  formatQuestionTime,
  getQuestionStatusLabel,
  isQuestionStatus,
  validateQuestionText,
} from "./questions.js";
import {
  createQuizConfiguration,
  getQuizComprehensionSignal,
  getParticipantId,
  getQuizMonitoringEntries,
  getQuizResponseRows,
  normalizePublicQuizActivity,
  validateQuizConfiguration,
} from "./quiz.js?v=quiz-monitoring-realtime-v1";
import { calculateSlotReductions } from "./overrun.js";
import { renderTimeline } from "./timeline.js";
import {
  createPresentationSession,
  createPublicSessionRoom,
  createPublicSessionQuestion,
  cancelPublicParticipantQuestion,
  createSharedPlenary,
  deleteSharedPlenary,
  forgetProject,
  getKnownProjects,
  loadPresentationSession,
  loadOwnedSessionQuestions,
  loadPublicParticipantQuestions,
  loadOwnedPublicSessionRoom,
  loadPublicSessionRoom,
  getPublicRoomActivity,
  loadSharedPlenary,
  rememberProject,
  saveSharedPlenary,
  setAuthAccessToken,
  subscribeToPresentationSession,
  subscribeToPublicRoomActivity,
  subscribeToQuizResponseEvents,
  subscribeToSessionQuestions,
  submitPublicQuizResponse,
  getOwnedQuizResponseSummary,
  publishPublicRoomActivity,
  updateOwnedSessionQuestionStatus,
  updatePublicParticipantQuestion,
  updatePresentationSession,
} from "./supabase.js?v=local-project-recovery-v1";
import {
  getCurrentAccessToken,
  getCurrentUser,
  initAuth,
  loginWithGoogle,
  logout,
  onAuthStateChange,
} from "../auth/auth.js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabaseConfig.js?v=access-v1";

const ROOM_ROUTE_RESTORE_KEY = "safe-timekeeper-public-room-path";
const restoredRoomPath = sessionStorage.getItem(ROOM_ROUTE_RESTORE_KEY);
if (restoredRoomPath) {
  sessionStorage.removeItem(ROOM_ROUTE_RESTORE_KEY);
  window.history.replaceState({}, "", restoredRoomPath);
}

const state = loadState();
const LOCAL_SESSION_KEY = "safe-timekeeper-active-session-v1";
const publicRoomToken = getRoomTokenFromPath();
let viewMode = new URLSearchParams(window.location.search).get("view") || "config";
let activeSessionId = new URLSearchParams(window.location.search).get("sessionId") || null;
let activeRoomToken = null;
let sessionVersion = null;
let stopSessionSubscription = null;
let stopQuestionsSubscription = null;
let stopPublicRoomActivity = null;
let stopQuizResponseEvents = null;
let publicQuiz = null;
let publicQuizSelection = null;
let monitoredQuizId = null;
let quizMonitoringSignature = null;
const quizResponseSummaries = new Map();
const selectedRecoverySlotIds = new Set();
let dismissedRecoverySlide = null;
let sessionWriteQueue = Promise.resolve();
let sessionQuestions = [];
let selectedQuestionId = null;
let publicParticipantQuestions = [];
let editingPublicQuestionId = null;
let tickHandle = null;
let fullscreenProgressAnimationHandle = null;
let currentPdfBuffer = null;
let hasUnsavedChanges = false;
let sideInfoIdleHandle = null;
let pdfImportRequestId = 0;
let savedProjectName = state.remoteToken ? state.projectName : "";
let tutorialStepIndex = 0;
let tutorialStrategyDialogOpen = false;
let accessMode = null;
let currentSession = null;
let slotWizard = null;
let presentationSession = null;
const fullscreenSlotProgressColors = {
  ok: "#007a78",
  warning: "#b76e00",
  danger: "#b42318",
};

const tutorialSteps = [
  {
    target: "#projectName",
    title: "Nommez votre projet",
    description: "Donnez un nom reconnaissable à votre plénière avant de la sauvegarder.",
  },
  {
    target: "#pdfUploadCard",
    title: "Importez la présentation",
    description: "Ajoutez le PDF dont les slides seront affichées pendant la plénière.",
  },
  {
    target: ".plenary-schedule",
    title: "Définissez l'horaire",
    description: "Indiquez l'heure de début et la durée totale de la réunion.",
    scrollBlock: "start",
    tooltipPlacement: "above",
  },
  {
    target: "#slotsPanel",
    title: "Organisez les créneaux",
    description: "Ajoutez les séquences, associez-leur des slides et attribuez leur durée.",
    tooltipPlacement: "left",
  },
  {
    target: "#startPresentationBtn",
    title: "Lancez la plénière",
    description: "Quand la configuration est complète, démarrez la présentation et suivez le temps en direct.",
  },
  {
    target: "#strategyDialog",
    title: "Choisissez la stratégie",
    description: "Déterminez comment absorber un dépassement: réduire les créneaux suivants, les derniers, répartir la réduction ou décaler la fin.",
    openStrategyDialog: true,
  },
];

const elements = {
  accessScreen: document.querySelector("#accessScreen"),
  appShell: document.querySelector(".app-shell"),
  googleSignInBtn: document.querySelector("#googleSignInBtn"),
  sandboxBtn: document.querySelector("#sandboxBtn"),
  accessError: document.querySelector("#accessError"),
  accessStatus: document.querySelector("#accessStatus"),
  signOutBtn: document.querySelector("#signOutBtn"),
  homeAccessBtn: document.querySelector("#homeAccessBtn"),
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
  tutorialBtn: document.querySelector("#tutorialBtn"),
  tutorialOverlay: document.querySelector("#tutorialOverlay"),
  tutorialShadeTop: document.querySelector("#tutorialShadeTop"),
  tutorialShadeRight: document.querySelector("#tutorialShadeRight"),
  tutorialShadeBottom: document.querySelector("#tutorialShadeBottom"),
  tutorialShadeLeft: document.querySelector("#tutorialShadeLeft"),
  tutorialTooltip: document.querySelector("#tutorialTooltip"),
  tutorialProgress: document.querySelector("#tutorialProgress"),
  tutorialTitle: document.querySelector("#tutorialTitle"),
  tutorialDescription: document.querySelector("#tutorialDescription"),
  tutorialPreviousBtn: document.querySelector("#tutorialPreviousBtn"),
  tutorialNextBtn: document.querySelector("#tutorialNextBtn"),
  closeTutorialBtn: document.querySelector("#closeTutorialBtn"),
  newProjectBtn: document.querySelector("#newProjectBtn"),
  projectsBtn: document.querySelector("#projectsBtn"),
  projectsDialog: document.querySelector("#projectsDialog"),
  projectSaveDialog: document.querySelector("#projectSaveDialog"),
  strategyDialog: document.querySelector("#strategyDialog"),
  slotWizardDialog: document.querySelector("#slotWizardDialog"),
  closeSlotWizardBtn: document.querySelector("#closeSlotWizardBtn"),
  slotWizardTypeStep: document.querySelector("#slotWizardTypeStep"),
  slotWizardStructureStep: document.querySelector("#slotWizardStructureStep"),
  slotWizardDetailsStep: document.querySelector("#slotWizardDetailsStep"),
  slotWizardTypeNextBtn: document.querySelector("#slotWizardTypeNextBtn"),
  slotWizardStructureBackBtn: document.querySelector("#slotWizardStructureBackBtn"),
  slotWizardStructureNextBtn: document.querySelector("#slotWizardStructureNextBtn"),
  slotWizardDetailsBackBtn: document.querySelector("#slotWizardDetailsBackBtn"),
  slotWizardCreateBtn: document.querySelector("#slotWizardCreateBtn"),
  slotWizardName: document.querySelector("#slotWizardName"),
  slotWizardEndSlide: document.querySelector("#slotWizardEndSlide"),
  slotWizardDuration: document.querySelector("#slotWizardDuration"),
  slotWizardSlideLabel: document.querySelector("#slotWizardSlideLabel"),
  slotWizardDetailsLead: document.querySelector("#slotWizardDetailsLead"),
  slotWizardTypeError: document.querySelector("#slotWizardTypeError"),
  slotWizardDetailsError: document.querySelector("#slotWizardDetailsError"),
  slotWizardPreview: document.querySelector("#slotWizardPreview"),
  closeProjectsBtn: document.querySelector("#closeProjectsBtn"),
  projectsList: document.querySelector("#projectsList"),
  saveBtn: document.querySelector("#saveBtn"),
  clearConfigBtn: document.querySelector("#clearConfigBtn"),
  storageStatus: document.querySelector("#storageStatus"),
  importProgress: document.querySelector("#importProgress"),
  progressLabel: document.querySelector("#progressLabel"),
  progressValue: document.querySelector("#progressValue"),
  progressFill: document.querySelector("#progressFill"),
  fullscreenSlotProgress: document.querySelector("#fullscreenSlotProgress"),
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
  fullscreenOverrun: document.querySelector("#fullscreenOverrun"),
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
  sessionDelayBadge: document.querySelector("#sessionDelayBadge"),
  sessionDelayLabel: document.querySelector("#sessionDelayLabel"),
  sessionDelay: document.querySelector("#sessionDelay"),
  estimatedEnd: document.querySelector("#estimatedEnd"),
  timelineTrack: document.querySelector("#timelineTrack"),
  nowMarker: document.querySelector("#nowMarker"),
  plannedStartLabel: document.querySelector("#plannedStartLabel"),
  plannedEndLabel: document.querySelector("#plannedEndLabel"),
  pdfPreviewState: document.querySelector("#pdfPreviewState"),
  roomAccess: document.querySelector("#roomAccess"),
  roomQrCode: document.querySelector("#roomQrCode"),
  roomLink: document.querySelector("#roomLink"),
  recoveryPanel: document.querySelector("#recoveryPanel"),
  recoveryDelay: document.querySelector("#recoveryDelay"),
  recoveryRecommendation: document.querySelector("#recoveryRecommendation"),
  recoverySlots: document.querySelector("#recoverySlots"),
  recoverySummary: document.querySelector("#recoverySummary"),
  keepRecoveryPlanBtn: document.querySelector("#keepRecoveryPlanBtn"),
  skipRecoverySlotsBtn: document.querySelector("#skipRecoverySlotsBtn"),
  publicRoomView: document.querySelector("#publicRoomView"),
  publicRoomStatus: document.querySelector("#publicRoomStatus"),
  publicRoomDetail: document.querySelector("#publicRoomDetail"),
  publicQuestionForm: document.querySelector("#publicQuestionForm"),
  publicQuestionInput: document.querySelector("#publicQuestionInput"),
  publicQuestionSubmit: document.querySelector("#publicQuestionSubmit"),
  publicQuestionFeedback: document.querySelector("#publicQuestionFeedback"),
  publicQuestions: document.querySelector("#publicQuestions"),
  publicQuestionsList: document.querySelector("#publicQuestionsList"),
  publicQuiz: document.querySelector("#publicQuiz"),
  publicQuizForm: document.querySelector("#publicQuizForm"),
  publicQuizQuestion: document.querySelector("#publicQuizQuestion"),
  publicQuizOptions: document.querySelector("#publicQuizOptions"),
  publicQuizSubmit: document.querySelector("#publicQuizSubmit"),
  publicQuizFeedback: document.querySelector("#publicQuizFeedback"),
  quizResponsesPanel: document.querySelector("#quizResponsesPanel"),
  quizMonitoringList: document.querySelector("#quizMonitoringList"),
  questionsPanel: document.querySelector("#questionsPanel"),
  questionsList: document.querySelector("#questionsList"),
  selectedQuestion: document.querySelector("#selectedQuestion"),
  selectedQuestionText: document.querySelector("#selectedQuestionText"),
  selectedQuestionTime: document.querySelector("#selectedQuestionTime"),
  selectedQuestionStatus: document.querySelector("#selectedQuestionStatus"),
  answerQuestionBtn: document.querySelector("#answerQuestionBtn"),
  dismissQuestionBtn: document.querySelector("#dismissQuestionBtn"),
};

function showApplication(mode, user = null, accessToken = null) {
  accessMode = mode;
  currentSession = user;
  setAuthAccessToken(accessToken);
  elements.accessScreen.hidden = true;
  elements.appShell.hidden = false;
  elements.signOutBtn.hidden = mode !== "authenticated";
  elements.homeAccessBtn.classList.toggle("is-sandbox-access", mode === "sandbox");
  elements.homeAccessBtn.disabled = mode !== "sandbox";
  elements.accessStatus.textContent = user?.email
    ? `Connecté : ${user.email}`
    : "Mode bac à sable";
}

function showAccessScreen() {
  accessMode = null;
  currentSession = null;
  setAuthAccessToken(null);
  elements.accessScreen.hidden = false;
  elements.accessError.hidden = true;
  elements.homeAccessBtn.classList.remove("is-sandbox-access");
  elements.homeAccessBtn.disabled = true;
}

function enterSandbox() {
  Object.assign(state, resetState());
  presentationSession = null;
  savedProjectName = "";
  hasUnsavedChanges = false;
  currentPdfBuffer = null;
  elements.pdfInput.value = "";
  stopTicking();
  switchView(false);
  renderConfiguration();
  updateSaveButton();
  window.history.replaceState({}, "", window.location.pathname);
  showApplication("sandbox");
  elements.storageStatus.textContent = "Bac à sable prêt à configurer";
}

async function handleGoogleSignIn() {
  elements.accessError.hidden = true;
  elements.googleSignInBtn.disabled = true;
  try {
    await loginWithGoogle();
  } catch (error) {
    console.error(error);
    elements.accessError.textContent = error.message || "La connexion Google est indisponible.";
    elements.accessError.hidden = false;
    elements.googleSignInBtn.disabled = false;
  }
}

async function handleSignOut() {
  try {
    await logout();
    showAccessScreen();
  } catch (error) {
    console.error(error);
    window.alert(error.message || "La déconnexion a échoué.");
  }
}

function persist() {
  saveState(state);
  hasUnsavedChanges = true;
  elements.saveBtn.disabled = false;
  elements.storageStatus.textContent = "Configuration locale enregistrée - synchronisation requise";
}

function updateSaveButton() {
  elements.saveBtn.disabled = !hasUnsavedChanges;
}

function clearTutorialHighlight() {
  const highlightedTarget = document.querySelector(".tutorial-target");
  if (!highlightedTarget) {
    return;
  }
  highlightedTarget.classList.remove("tutorial-target");
}

function closeTutorialStrategyDialog() {
  if (!tutorialStrategyDialogOpen) {
    return;
  }
  elements.strategyDialog.close();
  tutorialStrategyDialogOpen = false;
}

function positionTutorialShades(target) {
  const bounds = target.getBoundingClientRect();
  const spotlightPadding = 14;
  const spotlightTop = Math.max(0, bounds.top - spotlightPadding);
  const spotlightRight = Math.min(window.innerWidth, bounds.right + spotlightPadding);
  const spotlightBottom = Math.min(window.innerHeight, bounds.bottom + spotlightPadding);
  const spotlightLeft = Math.max(0, bounds.left - spotlightPadding);
  const setBounds = (element, top, right, bottom, left) => {
    element.style.top = `${top}px`;
    element.style.right = `${right}px`;
    element.style.bottom = `${bottom}px`;
    element.style.left = `${left}px`;
  };

  setBounds(elements.tutorialShadeTop, 0, 0, window.innerHeight - spotlightTop, 0);
  setBounds(elements.tutorialShadeRight, spotlightTop, 0, window.innerHeight - spotlightBottom, spotlightRight);
  setBounds(elements.tutorialShadeBottom, spotlightBottom, 0, 0, 0);
  setBounds(elements.tutorialShadeLeft, spotlightTop, window.innerWidth - spotlightLeft, window.innerHeight - spotlightBottom, 0);
}

function positionTutorialTooltip(target, placement = "auto") {
  const targetBounds = target.getBoundingClientRect();
  const tooltipBounds = elements.tutorialTooltip.getBoundingClientRect();
  const horizontalPadding = 16;
  const preferredTop = targetBounds.bottom + 18;
  const fallbackTop = preferredTop + tooltipBounds.height <= window.innerHeight - horizontalPadding
    ? preferredTop
    : Math.max(horizontalPadding, targetBounds.top - tooltipBounds.height - 18);
  const fallbackLeft = Math.min(
    Math.max(horizontalPadding, targetBounds.left),
    window.innerWidth - tooltipBounds.width - horizontalPadding,
  );
  const preferredLeft = targetBounds.left - tooltipBounds.width - 18;
  const useLeftPlacement = placement === "left" && preferredLeft >= horizontalPadding;
  const preferredAbove = targetBounds.top - tooltipBounds.height - 18;
  const useAbovePlacement = placement === "above" && preferredAbove >= horizontalPadding;
  const top = useLeftPlacement
    ? Math.min(
      Math.max(horizontalPadding, targetBounds.top),
      window.innerHeight - tooltipBounds.height - horizontalPadding,
    )
    : useAbovePlacement
      ? preferredAbove
      : fallbackTop;
  const left = useLeftPlacement ? preferredLeft : fallbackLeft;
  elements.tutorialTooltip.style.top = `${top}px`;
  elements.tutorialTooltip.style.left = `${left}px`;
}

function renderTutorialStep() {
  clearTutorialHighlight();
  const step = tutorialSteps[tutorialStepIndex];
  if (step.openStrategyDialog && !elements.strategyDialog.open) {
    elements.strategyDialog.show();
    tutorialStrategyDialogOpen = true;
  } else if (!step.openStrategyDialog) {
    closeTutorialStrategyDialog();
  }
  const target = document.querySelector(step.target);
  if (!target) {
    closeTutorial();
    return;
  }

  target.scrollIntoView({ block: step.scrollBlock || "center", inline: "nearest", behavior: "auto" });
  target.classList.add("tutorial-target");
  elements.tutorialProgress.textContent = `Étape ${tutorialStepIndex + 1} sur ${tutorialSteps.length}`;
  elements.tutorialTitle.textContent = step.title;
  elements.tutorialDescription.textContent = step.description;
  elements.tutorialPreviousBtn.disabled = tutorialStepIndex === 0;
  elements.tutorialNextBtn.textContent = tutorialStepIndex === tutorialSteps.length - 1 ? "Terminer" : "Suivant";
  positionTutorialShades(target);
  positionTutorialTooltip(target, step.tooltipPlacement);
}

function openTutorial() {
  if (elements.presentationView.classList.contains("active")) {
    leavePresentationMode();
  }
  tutorialStepIndex = 0;
  elements.tutorialOverlay.hidden = false;
  renderTutorialStep();
  elements.tutorialNextBtn.focus();
}

function closeTutorial() {
  clearTutorialHighlight();
  closeTutorialStrategyDialog();
  elements.tutorialOverlay.hidden = true;
  elements.tutorialTooltip.style.removeProperty("top");
  elements.tutorialTooltip.style.removeProperty("left");
  elements.tutorialBtn.focus();
}

function goToTutorialStep(offset) {
  const nextStepIndex = tutorialStepIndex + offset;
  if (nextStepIndex >= tutorialSteps.length) {
    closeTutorial();
    return;
  }
  tutorialStepIndex = Math.max(0, nextStepIndex);
  renderTutorialStep();
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
  const ownerUserId = accessMode === "authenticated" ? currentSession?.id : null;
  const projects = getKnownProjects().filter((project) => project.ownerUserId === ownerUserId);
  elements.projectsList.innerHTML = "";

  if (projects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = accessMode === "authenticated"
      ? "Aucun projet personnel n'a encore été sauvegardé sur ce navigateur."
      : "Aucun projet bac à sable n'a encore été sauvegardé sur ce navigateur.";
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
  presentationSession = null;
  currentPdfBuffer = null;
  elements.pdfInput.value = "";
  stopTicking();
  switchView(false);
  saveState(state);
  rememberProject(token, state.projectName, currentSession?.id);
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
    presentationSession = null;
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
    rememberProject(state.remoteToken, state.projectName, currentSession?.id);
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
  presentationSession = null;
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
    const quiz = slot.type === "quiz" ? slot.quiz : null;
    const quizOptions = quiz?.options.filter((option) => option.label.trim()) || [];
    const correctOptionChoices = quizOptions.map((option) => `
      <option value="${option.id}" ${quiz.correctOptionId === option.id ? "selected" : ""}>
        ${option.id} - ${escapeHtml(option.label)}
      </option>
    `).join("");
    const article = document.createElement("article");
    article.className = "slot-card";
    article.classList.toggle("is-optional", slot.optional);
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
        <label class="slot-optional-control" for="slot-optional-${slot.id}">
          <input id="slot-optional-${slot.id}" type="checkbox" ${slot.optional ? "checked" : ""} data-slot-id="${slot.id}" data-field="optional" />
          <span>Créneau optionnel<small>Pourra être proposé comme possibilité de rattrapage.</small></span>
        </label>
        <div class="slot-actions">
          <button type="button" class="ghost-button" data-move="up" data-slot-id="${slot.id}" ${index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="ghost-button" data-move="down" data-slot-id="${slot.id}" ${index === state.slots.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="danger-button" data-remove="${slot.id}">Supprimer</button>
        </div>
      </div>
      ${quiz ? `
        <fieldset class="quiz-configuration" data-quiz-slot-id="${slot.id}">
          <legend>Configuration du quiz</legend>
          <div class="field">
            <label for="quiz-question-${slot.id}">Question du quiz</label>
            <textarea id="quiz-question-${slot.id}" data-quiz-slot-id="${slot.id}" data-quiz-field="question">${escapeHtml(quiz.question)}</textarea>
          </div>
          <div class="quiz-configuration-options">
            ${quiz.options.map((option) => `
              <div class="field">
                <label for="quiz-option-${slot.id}-${option.id}">Proposition ${option.id}${option.id === "A" || option.id === "B" ? "" : " (facultative)"}</label>
                <input id="quiz-option-${slot.id}-${option.id}" type="text" value="${escapeHtml(option.label)}" data-quiz-slot-id="${slot.id}" data-quiz-option-id="${option.id}" />
              </div>
            `).join("")}
          </div>
          <div class="field">
            <label for="quiz-correct-option-${slot.id}">Bonne réponse</label>
            <select id="quiz-correct-option-${slot.id}" data-quiz-slot-id="${slot.id}" data-quiz-field="correctOptionId">
              <option value="">Choisir une proposition</option>
              ${correctOptionChoices}
            </select>
          </div>
          <p class="quiz-configuration-status">${validateQuizConfiguration(quiz).error || "Quiz prêt pour la plénière."}</p>
        </fieldset>
      ` : ""}
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

  if (field === "optional") {
    slot.optional = Boolean(value);
  } else if (field === "name") {
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

function refreshQuizCorrectOption(slot) {
  const select = elements.slotsList.querySelector(`#quiz-correct-option-${slot.id}`);
  if (!select) return;
  const options = slot.quiz.options.filter((option) => option.label.trim());
  select.replaceChildren(
    new Option("Choisir une proposition", ""),
    ...options.map((option) => new Option(`${option.id} - ${option.label}`, option.id, false, slot.quiz.correctOptionId === option.id)),
  );
}

function updateQuizSlot(slotId, field, value) {
  const slot = state.slots.find((item) => item.id === slotId && item.type === "quiz");
  if (!slot?.quiz) return;
  if (field === "question" || field === "correctOptionId") {
    slot.quiz[field] = value;
  } else if (field === "option") {
    const option = slot.quiz.options.find((item) => item.id === value.id);
    if (!option) return;
    option.label = value.label;
    if (slot.quiz.correctOptionId === option.id && !option.label.trim()) slot.quiz.correctOptionId = "";
  }
  persist();
  refreshQuizCorrectOption(slot);
  const status = elements.slotsList.querySelector(`[data-quiz-slot-id="${slot.id}"] .quiz-configuration-status`);
  if (status) status.textContent = validateQuizConfiguration(slot.quiz).error || "Quiz prêt pour la plénière.";
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

function getNextSlotStartSlide() {
  const previousSlot = state.slots.at(-1);
  return previousSlot ? Number(previousSlot.endSlide || 0) + 1 : 1;
}

function getSlotWizardCapacity() {
  const maxSlide = Math.max(state.pageCount, 1);
  const startSlide = getNextSlotStartSlide();
  return {
    startSlide,
    maxSlide,
    availableSlides: Math.max(0, maxSlide - startSlide + 1),
  };
}

function setSlotWizardError(element, message = "") {
  element.textContent = message;
  element.hidden = !message;
}

function closeSlotWizard() {
  elements.slotWizardDialog.close();
  slotWizard = null;
}

function renderSlotWizardDetails() {
  const { startSlide, maxSlide, availableSlides } = getSlotWizardCapacity();
  const isInteractive = slotWizard.structure === "interactive";
  const isPresentation = slotWizard.type === "presentation";
  const requiredSlides = isInteractive ? 3 : 1;
  const hasCapacity = availableSlides >= requiredSlides;
  const endSlideMaximum = isInteractive ? maxSlide - 2 : maxSlide;
  const defaultEndSlide = isInteractive ? endSlideMaximum : startSlide;

  elements.slotWizardDetailsLead.textContent = isPresentation
    ? `La présentation commencera à la slide ${startSlide}.`
    : `Le créneau utilisera la slide ${startSlide}.`;
  elements.slotWizardSlideLabel.textContent = isPresentation ? "Dernière slide" : "Slide";
  elements.slotWizardEndSlide.min = String(startSlide);
  elements.slotWizardEndSlide.max = String(endSlideMaximum);
  elements.slotWizardEndSlide.readOnly = !isPresentation;
  elements.slotWizardEndSlide.value = String(defaultEndSlide);
  elements.slotWizardDuration.value = "1";
  elements.slotWizardName.value = isPresentation
    ? `Créneau ${state.slots.length + 1}`
    : `${slotWizard.type === "question" ? "Question" : "Quiz"} ${state.slots.length + 1}`;
  elements.slotWizardPreview.hidden = !isInteractive;
  setSlotWizardError(
    elements.slotWizardDetailsError,
    hasCapacity ? "" : `Cette position ne laisse pas assez de slides libres pour créer ${isInteractive ? "une présentation interactive" : "ce créneau"}.`,
  );
  elements.slotWizardCreateBtn.disabled = !hasCapacity;
  renderSlotWizardPreview();
}

function renderSlotWizardPreview() {
  if (!slotWizard || slotWizard.structure !== "interactive") {
    return;
  }

  const { startSlide } = getSlotWizardCapacity();
  const endSlide = Number(elements.slotWizardEndSlide.value);
  const durationMinutes = Number(elements.slotWizardDuration.value);
  const isValid = Number.isFinite(endSlide) && endSlide >= startSlide && Number.isFinite(durationMinutes) && durationMinutes > 0;
  if (!isValid) {
    elements.slotWizardPreview.innerHTML = "";
    return;
  }

  const rows = [
    ["Présentation", startSlide, endSlide, durationMinutes],
    ["Question", endSlide + 1, endSlide + 1, 1],
    ["Quiz", endSlide + 2, endSlide + 2, 1],
  ];
  elements.slotWizardPreview.innerHTML = `
    <h3>Votre séquence</h3>
    ${rows.map(([name, start, end, duration]) => `<div class="slot-wizard-preview-row"><strong>${name}</strong><span>${start} → ${end}</span><span>${duration} min</span></div>`).join("")}
    <p class="slot-wizard-preview-total"><strong>Total : ${durationMinutes + 2} min</strong></p>
  `;
}

function openSlotWizard() {
  slotWizard = { type: null, structure: "single" };
  document.querySelectorAll('input[name="slotWizardType"]').forEach((input) => {
    input.checked = false;
  });
  document.querySelector('input[name="slotWizardStructure"][value="single"]').checked = true;
  elements.slotWizardTypeStep.hidden = false;
  elements.slotWizardStructureStep.hidden = true;
  elements.slotWizardDetailsStep.hidden = true;
  elements.slotWizardTypeNextBtn.disabled = true;
  setSlotWizardError(elements.slotWizardTypeError);
  setSlotWizardError(elements.slotWizardDetailsError);
  elements.slotWizardDialog.showModal();
}

function showSlotWizardDetails() {
  elements.slotWizardTypeStep.hidden = true;
  elements.slotWizardStructureStep.hidden = true;
  elements.slotWizardDetailsStep.hidden = false;
  renderSlotWizardDetails();
}

function createSlotsFromWizard() {
  const { startSlide, maxSlide } = getSlotWizardCapacity();
  const endSlide = Number(elements.slotWizardEndSlide.value);
  const durationMinutes = Number(elements.slotWizardDuration.value);
  const requiredSlides = slotWizard.structure === "interactive" ? 3 : 1;
  const hasValidRange = Number.isInteger(endSlide) && endSlide >= startSlide && endSlide <= maxSlide - requiredSlides + 1;
  if (!hasValidRange || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    setSlotWizardError(elements.slotWizardDetailsError, "Renseignez une plage de slides et une durée valides.");
    return;
  }

  const name = elements.slotWizardName.value.trim() || `Créneau ${state.slots.length + 1}`;
  const slotEndSlide = slotWizard.type === "presentation" ? endSlide : startSlide;
  const slotsToAdd = [{
    id: crypto.randomUUID(),
    name,
    type: slotWizard.type,
    startSlide,
    endSlide: slotEndSlide,
    durationMinutes,
    optional: false,
    ...(slotWizard.type === "quiz" ? { quiz: createQuizConfiguration() } : {}),
  }];
  if (slotWizard.structure === "interactive") {
    slotsToAdd.push(
      { id: crypto.randomUUID(), name: "Question", type: "question", startSlide: endSlide + 1, endSlide: endSlide + 1, durationMinutes: 1, optional: false },
      { id: crypto.randomUUID(), name: "Quiz", type: "quiz", startSlide: endSlide + 2, endSlide: endSlide + 2, durationMinutes: 1, optional: false, quiz: createQuizConfiguration() },
    );
  }

  state.slots.push(...slotsToAdd);
  persist();
  renderConfiguration();
  closeSlotWizard();
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
  elements.presentationView.classList.toggle("monitoring-view", isPresentation && viewMode === "monitoring");
  document.body.classList.toggle("is-presenting", isPresentation);
  document.body.classList.toggle("is-monitoring", isPresentation && viewMode === "monitoring");
}

function openMonitoringView(sessionId, monitoringWindow = null) {
  const monitoringUrl = new URL(window.location.href);
  monitoringUrl.searchParams.set("view", "monitoring");
  if (sessionId) {
    monitoringUrl.searchParams.set("sessionId", sessionId);
  } else {
    monitoringUrl.searchParams.delete("sessionId");
  }
  if (monitoringWindow) {
    monitoringWindow.location.replace(monitoringUrl.href);
    return;
  }
  window.open(monitoringUrl.href, `timekeeper-monitoring-${crypto.randomUUID()}`);
}

function renderRoomAccess() {
  const isVisible = viewMode === "monitoring" && Boolean(activeRoomToken);
  elements.roomAccess.hidden = !isVisible;
  if (!isVisible) {
    return;
  }

  const roomUrl = getPublicRoomUrl(activeRoomToken);
  elements.roomLink.href = roomUrl;
  elements.roomLink.textContent = roomUrl;
  elements.roomQrCode.dataset.roomUrl = roomUrl;
  elements.roomQrCode.replaceChildren();
  if (window.QRCode) {
    new window.QRCode(elements.roomQrCode, {
      text: roomUrl,
      width: 176,
      height: 176,
      colorDark: "#003b5c",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  }
}

function showPublicRoomView() {
  document.body.classList.add("is-public-room");
  elements.accessScreen.hidden = true;
  elements.appShell.hidden = true;
  elements.publicRoomView.hidden = false;
}

async function loadPublicRoom(roomToken) {
  showPublicRoomView();
  try {
    const room = await loadPublicSessionRoom(roomToken);
    if (!room || room.status === "completed") {
      elements.publicRoomStatus.textContent = "Cette session n'est plus disponible";
      elements.publicRoomDetail.textContent = "Le lien est invalide ou la session est terminée.";
      return;
    }
    elements.publicRoomStatus.textContent = "Vous êtes connecté";
    elements.publicRoomDetail.textContent = room.isRunning
      ? "La session est en cours. Restez sur cette page pour participer aux prochaines activités."
      : "En attente du début de la session.";
    initAuth({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY });
    stopPublicRoomActivity?.();
    stopPublicRoomActivity = subscribeToPublicRoomActivity(roomToken, () => {
      refreshPublicRoomActivity().catch((error) => console.error("Impossible d'actualiser l'activité du Room.", error));
    });
    await refreshPublicRoomActivity();
    await refreshPublicParticipantQuestions();
  } catch (error) {
    console.error("Impossible de rejoindre le Room.", error);
    elements.publicRoomStatus.textContent = "Cette session n'est plus disponible";
    elements.publicRoomDetail.textContent = "Le lien est invalide ou la session est terminée.";
  }
}

function renderPublicQuiz(activity) {
  const quiz = normalizePublicQuizActivity(activity);
  const selectedOptionId = publicQuiz?.id === quiz?.id ? publicQuizSelection : null;
  publicQuiz = quiz;
  publicQuizSelection = selectedOptionId;
  elements.publicQuiz.hidden = !quiz;
  elements.publicQuestionForm.hidden = Boolean(quiz);
  if (!quiz) {
    elements.publicQuizOptions.replaceChildren();
    elements.publicQuizFeedback.textContent = "";
    return;
  }

  elements.publicQuizQuestion.textContent = quiz.question;
  elements.publicQuizOptions.replaceChildren(...quiz.options.map((option) => {
    const label = document.createElement("label");
    label.className = "quiz-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "quizOption";
    input.value = option.id;
    input.checked = option.id === selectedOptionId;
    input.disabled = quiz.hasResponded;
    label.append(input, document.createTextNode(option.label));
    return label;
  }));
  elements.publicQuizSubmit.disabled = quiz.hasResponded || !selectedOptionId;
  elements.publicQuizFeedback.textContent = quiz.hasResponded ? "Réponse enregistrée ✓" : "";
}

async function refreshPublicRoomActivity() {
  const activity = await getPublicRoomActivity(publicRoomToken, getParticipantId());
  renderPublicQuiz(activity);
}

function renderPublicParticipantQuestions() {
  elements.publicQuestions.hidden = publicParticipantQuestions.length === 0;
  elements.publicQuestionsList.replaceChildren(...publicParticipantQuestions.map((question) => {
    const item = document.createElement("article");
    item.className = "public-question-item";
    const summary = document.createElement("div");
    summary.className = "public-question-summary";
    const text = document.createElement("strong");
    text.textContent = question.text;
    const status = document.createElement("p");
    status.className = "question-feedback";
    status.textContent = `Statut : ${getQuestionStatusLabel(question.status)}`;
    const actions = document.createElement("div");
    actions.className = "public-question-actions";
    const edit = document.createElement("button");
    edit.className = "public-question-icon-button";
    edit.type = "button";
    edit.dataset.editPublicQuestionId = question.id;
    edit.setAttribute("aria-label", "Modifier la question");
    edit.title = "Modifier la question";
    edit.innerHTML = "&#9998;";
    const cancel = document.createElement("button");
    cancel.className = "public-question-icon-button";
    cancel.type = "button";
    cancel.dataset.cancelPublicQuestionId = question.id;
    cancel.setAttribute("aria-label", "Supprimer la question");
    cancel.title = "Supprimer la question";
    cancel.innerHTML = "&#128465;";
    const isCancelled = question.status === "cancelled";
    edit.hidden = isCancelled;
    cancel.hidden = isCancelled;
    actions.append(edit, cancel);
    summary.append(text, status, actions);
    item.append(summary);

    if (editingPublicQuestionId === question.id) {
      const form = document.createElement("form");
      form.className = "public-question-editor";
      form.dataset.publicQuestionId = question.id;
      const input = document.createElement("textarea");
      input.name = "text";
      input.maxLength = 500;
      input.value = question.text;
      const save = document.createElement("button");
      save.className = "secondary-button";
      save.type = "submit";
      save.textContent = "Enregistrer";
      const close = document.createElement("button");
      close.className = "ghost-button";
      close.type = "button";
      close.dataset.closePublicQuestionEditor = question.id;
      close.textContent = "Annuler";
      form.append(input, save, close);
      item.append(form);
    }
    return item;
  }));
}

async function refreshPublicParticipantQuestions() {
  publicParticipantQuestions = await loadPublicParticipantQuestions(publicRoomToken, getParticipantId()) || [];
  if (!publicParticipantQuestions.some((question) => question.id === editingPublicQuestionId)) {
    editingPublicQuestionId = null;
  }
  renderPublicParticipantQuestions();
}

async function submitPublicQuiz(event) {
  event.preventDefault();
  const selected = elements.publicQuizOptions.querySelector("input:checked");
  if (!selected || !publicQuiz) return;

  elements.publicQuizSubmit.disabled = true;
  elements.publicQuizFeedback.textContent = "";
  try {
    await submitPublicQuizResponse(publicRoomToken, getParticipantId(), selected.value);
    elements.publicQuizOptions.querySelectorAll("input").forEach((input) => { input.disabled = true; });
    elements.publicQuizFeedback.textContent = "Réponse enregistrée ✓";
  } catch (error) {
    console.error("Impossible d'enregistrer la réponse au quiz.", error);
    try {
      await refreshPublicRoomActivity();
    } catch (refreshError) {
      console.error("Impossible de vérifier l'état de la réponse au quiz.", refreshError);
    }
    if (!publicQuiz?.hasResponded) {
      elements.publicQuizSubmit.disabled = false;
      elements.publicQuizFeedback.textContent = "Impossible d'enregistrer la réponse. Réessayez.";
    }
  }
}

function renderQuestions() {
  const isMonitoring = viewMode === "monitoring" && Boolean(activeSessionId);
  elements.questionsPanel.hidden = !isMonitoring;
  if (!isMonitoring) {
    return;
  }
  const questions = [...sessionQuestions].sort((first, second) => second.created_at.localeCompare(first.created_at));
  if (!questions.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "questions-empty";
    emptyState.textContent = "Aucune question pour le moment.";
    elements.questionsList.replaceChildren(emptyState);
  } else {
    elements.questionsList.replaceChildren(...questions.map((question) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "question-item";
    item.classList.toggle("is-selected", question.id === selectedQuestionId);
    item.dataset.questionId = question.id;
    const status = document.createElement("span");
    status.className = "question-status";
    status.textContent = getQuestionStatusLabel(question.status);
    const text = document.createElement("strong");
    text.textContent = question.text;
    const time = document.createElement("small");
    time.textContent = formatQuestionTime(question.created_at);
    item.append(status, text, time);
    return item;
    }));
  }
  const selectedQuestion = sessionQuestions.find((question) => question.id === selectedQuestionId);
  elements.selectedQuestion.hidden = !selectedQuestion;
  if (selectedQuestion) {
    elements.selectedQuestionText.textContent = selectedQuestion.text;
    elements.selectedQuestionTime.textContent = formatQuestionTime(selectedQuestion.created_at);
    elements.selectedQuestionStatus.textContent = getQuestionStatusLabel(selectedQuestion.status);
    const isPending = selectedQuestion.status === "pending";
    elements.answerQuestionBtn.disabled = !isPending;
    elements.dismissQuestionBtn.disabled = !isPending;
  }
}

function upsertQuestion(question) {
  const index = sessionQuestions.findIndex((item) => item.id === question.id);
  if (index < 0) {
    sessionQuestions.unshift(question);
  } else {
    sessionQuestions[index] = question;
  }
  renderQuestions();
}

async function loadQuestionsForMonitoring(sessionId) {
  if (viewMode !== "monitoring") {
    return;
  }
  sessionQuestions = await loadOwnedSessionQuestions(sessionId) || [];
  renderQuestions();
  stopQuestionsSubscription?.();
  stopQuestionsSubscription = subscribeToSessionQuestions(sessionId, upsertQuestion, upsertQuestion);
}

async function submitPublicQuestion(event) {
  event.preventDefault();
  const result = validateQuestionText(elements.publicQuestionInput.value);
  elements.publicQuestionFeedback.textContent = result.error;
  if (!result.valid) {
    return;
  }
  elements.publicQuestionSubmit.disabled = true;
  try {
    await createPublicSessionQuestion(publicRoomToken, getParticipantId(), result.text);
    elements.publicQuestionInput.value = "";
    elements.publicQuestionFeedback.textContent = "Question envoyée";
    await refreshPublicParticipantQuestions();
  } catch (error) {
    console.error("Impossible d'envoyer la question.", error);
    elements.publicQuestionFeedback.textContent = "Impossible d'envoyer la question. Réessayez.";
  } finally {
    elements.publicQuestionSubmit.disabled = false;
  }
}

async function updatePublicQuestion(event) {
  event.preventDefault();
  const form = event.target;
  const result = validateQuestionText(new FormData(form).get("text"));
  if (!result.valid) return;
  try {
    await updatePublicParticipantQuestion(publicRoomToken, getParticipantId(), form.dataset.publicQuestionId, result.text);
    editingPublicQuestionId = null;
    await refreshPublicParticipantQuestions();
  } catch (error) {
    console.error("Impossible de modifier la question.", error);
  }
}

async function cancelPublicQuestion(questionId) {
  try {
    await cancelPublicParticipantQuestion(publicRoomToken, getParticipantId(), questionId);
    await refreshPublicParticipantQuestions();
  } catch (error) {
    console.error("Impossible d'annuler la question.", error);
  }
}

async function updateSelectedQuestionStatus(status) {
  const question = sessionQuestions.find((item) => item.id === selectedQuestionId);
  if (!question || !isQuestionStatus(status)) {
    return;
  }
  try {
    const updatedQuestion = await updateOwnedSessionQuestionStatus(question.id, status);
    upsertQuestion(updatedQuestion);
  } catch (error) {
    console.error("Impossible de modifier le statut de la question.", error);
  }
}

function applySessionRecord(record) {
  if (record.project) {
    Object.assign(state, normalizeState(record.project));
  }
  presentationSession = normalizeSessionState(record.state);
  activeSessionId = record.id;
  sessionVersion = Number(record.version);
  renderRoomAccess();
  renderQuestions();
  switchView(true);
  setPresentationDetailsCollapsed(viewMode === "presentation");
  renderPresentationMetrics();
  if (viewMode === "presentation") {
    renderCurrentSlide().catch((error) => console.error("Impossible de rendre la slide synchronisée.", error));
  }
  startTicking();
}

function applyLocalSessionRecord(record) {
  if (!record?.session) {
    return;
  }
  if (record.project) {
    Object.assign(state, normalizeState(record.project));
  }
  presentationSession = normalizeSessionState(record.session);
  switchView(true);
  setPresentationDetailsCollapsed(viewMode === "presentation");
  renderPresentationMetrics();
  if (viewMode === "presentation") {
    renderCurrentSlide().catch((error) => console.error("Impossible de rendre la slide locale.", error));
  }
  startTicking();
}

function saveLocalSession() {
  if (!presentationSession) {
    return;
  }
  localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({
    session: presentationSession,
    project: state,
  }));
}

function loadLocalSession() {
  try {
    const record = JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY) || "null");
    applyLocalSessionRecord(record);
    return Boolean(record?.session);
  } catch (error) {
    console.warn("Impossible de restaurer la session locale.", error);
    return false;
  }
}

async function joinPresentationSession(sessionId) {
  const record = await loadPresentationSession(sessionId);
  if (!record) {
    throw new Error("Cette session est introuvable ou vous n'y avez pas accès.");
  }
  applySessionRecord(record);
  quizResponseSummaries.clear();
  quizMonitoringSignature = null;
  monitoredQuizId = null;
  selectedRecoverySlotIds.clear();
  dismissedRecoverySlide = null;
  const room = await loadOwnedPublicSessionRoom(sessionId);
  activeRoomToken = room?.roomToken || null;
  stopQuizResponseEvents?.();
  if (viewMode === "monitoring") {
    stopQuizResponseEvents = subscribeToQuizResponseEvents(sessionId, ({ new: event }) => {
      if (event.quiz_id === monitoredQuizId) {
        refreshQuizMonitoring(true).catch((error) => console.error("Impossible d'actualiser les réponses au quiz.", error));
      }
    });
  }
  renderRoomAccess();
  await loadQuestionsForMonitoring(sessionId);
  stopSessionSubscription?.();
  stopSessionSubscription = subscribeToPresentationSession(sessionId, (remoteSession) => {
    if (Number(remoteSession.version) <= sessionVersion) {
      return;
    }
    applySessionRecord(remoteSession);
  });
}

function renderQuizMonitoring(entries) {
  elements.quizResponsesPanel.hidden = viewMode !== "monitoring" || !entries.length;
  elements.quizMonitoringList.replaceChildren(...entries.map(({ slot, status }) => {
    const item = document.createElement("section");
    item.className = `quiz-monitoring-item is-${status}`;
    const stateLabel = document.createElement("p");
    stateLabel.className = "quiz-monitoring-status";
    stateLabel.textContent = status === "active" ? "● QUIZ ACTIF" : status === "completed" ? "✓ TERMINÉ" : "○ À VENIR";
    const title = document.createElement("strong");
    title.textContent = slot.name;
    const question = document.createElement("p");
    question.className = "quiz-responses-question";
    question.textContent = slot.quiz.question;
    item.append(stateLabel, title, question);
    const validation = validateQuizConfiguration(slot.quiz);
    if (!validation.valid) {
      item.append(Object.assign(document.createElement("p"), { textContent: "La configuration de ce Quiz est incomplète." }));
    } else if (status === "upcoming") {
      item.append(Object.assign(document.createElement("p"), { className: "quiz-responses-count", textContent: "Résultats disponibles après activation." }));
    } else {
      const summary = quizResponseSummaries.get(slot.quiz.id) || { counts: {}, totalResponses: 0 };
      const comprehension = getQuizComprehensionSignal(slot.quiz, summary);
      const options = document.createElement("div");
      options.className = "quiz-responses-options";
      options.replaceChildren(...getQuizResponseRows(slot.quiz, summary.counts).map((option) => {
        const row = document.createElement("div");
        row.className = "quiz-response-option";
        row.append(
          Object.assign(document.createElement("strong"), { textContent: option.id }),
          Object.assign(document.createElement("span"), { textContent: option.label }),
          Object.assign(document.createElement("span"), { textContent: `${option.count} réponse(s)` }),
        );
        return row;
      }));
      const total = document.createElement("p");
      total.className = "quiz-responses-count";
      total.textContent = `Total : ${comprehension.totalResponses} réponse(s)`;
      item.append(options, total);
      if (!comprehension.classification) {
        item.append(Object.assign(document.createElement("p"), { className: "quiz-comprehension-empty", textContent: "Aucune réponse." }));
      } else {
        const signal = document.createElement("p");
        signal.className = `quiz-comprehension-signal is-${comprehension.classification}`;
        const rate = Math.round(comprehension.correctRate * 100);
        const label = comprehension.classification === "good"
          ? "✓ Bonne compréhension"
          : comprehension.classification === "mixed"
            ? "⚠ Compréhension à surveiller"
            : "⚠ Compréhension insuffisante";
        signal.textContent = `${comprehension.correctResponses} bonne(s) réponse(s) · ${rate} % · ${label}`;
        item.append(signal);
      }
    }
    return item;
  }));
}

function renderRecoveryProposal(delayMs) {
  const futureOptionalSlots = getFutureOptionalSlots(
    state.slots,
    presentationSession.currentSlide,
    presentationSession.skippedSlotIds,
  );
  const isVisible = viewMode === "monitoring"
    && delayMs > 0
    && futureOptionalSlots.length > 0
    && dismissedRecoverySlide !== presentationSession.currentSlide;
  elements.recoveryPanel.hidden = !isVisible;
  if (!isVisible) return;

  const availableSlotIds = new Set(futureOptionalSlots.map((slot) => slot.id));
  selectedRecoverySlotIds.forEach((slotId) => {
    if (!availableSlotIds.has(slotId)) selectedRecoverySlotIds.delete(slotId);
  });
  const selectedSlots = futureOptionalSlots.filter((slot) => selectedRecoverySlotIds.has(slot.id));
  const recovery = getRecoverySummary(delayMs, selectedSlots);
  const recommendation = getRecoveryRecommendation(delayMs, futureOptionalSlots);
  elements.recoveryDelay.textContent = `Retard actuel : +${formatClock(delayMs)}`;
  if (recommendation.fullyRecovers) {
    const suggestedNames = recommendation.suggestedSlots.map((slot) => slot.name).join(" + ");
    const suggestedRecovery = getRecoverySummary(delayMs, recommendation.suggestedSlots);
    elements.recoveryRecommendation.textContent = `Vous pouvez récupérer jusqu'à ${formatClock(recommendation.recoverableMs)}. Suggestion : supprimer ${suggestedNames} (${formatClock(suggestedRecovery.recoveryMs)}).`;
  } else {
    elements.recoveryRecommendation.textContent = `Vous pouvez récupérer jusqu'à ${formatClock(recommendation.recoverableMs)}. Ce total ne couvre pas entièrement le retard actuel.`;
  }
  elements.recoverySlots.replaceChildren(...futureOptionalSlots.map((slot) => {
    const label = document.createElement("label");
    label.className = "recovery-slot";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = slot.id;
    input.checked = selectedRecoverySlotIds.has(slot.id);
    const name = document.createElement("strong");
    name.textContent = slot.name;
    const details = document.createElement("small");
    details.textContent = `${slot.type} · ${slot.durationMinutes} min`;
    label.append(input, name, details);
    return label;
  }));
  elements.recoverySummary.textContent = `Récupération : ${formatClock(recovery.recoveryMs)} · Retard restant : ${formatClock(recovery.remainingDelayMs)}`;
  elements.skipRecoverySlotsBtn.disabled = selectedSlots.length === 0;
}

function keepRecoveryPlan() {
  selectedRecoverySlotIds.clear();
  dismissedRecoverySlide = presentationSession?.currentSlide ?? null;
  renderPresentationMetrics();
}

function skipSelectedRecoverySlots() {
  const selectableSlots = getFutureOptionalSlots(
    state.slots,
    presentationSession.currentSlide,
    presentationSession.skippedSlotIds,
  );
  const selectedSlots = selectableSlots.filter((slot) => selectedRecoverySlotIds.has(slot.id));
  if (!selectedSlots.length) return;

  presentationSession.skippedSlotIds = [...new Set([
    ...presentationSession.skippedSlotIds,
    ...selectedSlots.map((slot) => slot.id),
  ])];
  selectedRecoverySlotIds.clear();
  dismissedRecoverySlide = null;
  const nextSlide = getNextAvailableSlide(
    state.slots,
    presentationSession.currentSlide,
    state.pageCount,
    presentationSession.skippedSlotIds,
  );
  if (nextSlide !== presentationSession.currentSlide) {
    captureCompletedSlotDebt(presentationSession.currentSlide, nextSlide);
    presentationSession.currentSlide = nextSlide;
    const nextSlot = getCurrentSlot(
      getSlotTiming(getActiveSessionSlots(state.slots, presentationSession.skippedSlotIds), presentationSession.slotReductionsMs),
      nextSlide,
    );
    if (nextSlot && presentationSession.slotStartedElapsedMs[nextSlot.id] === undefined) {
      presentationSession.slotStartedElapsedMs[nextSlot.id] = getElapsedMs(presentationSession);
    }
    renderCurrentSlide();
  }
  renderPresentationMetrics();
  syncPresentationSession();
}

async function refreshQuizMonitoring(force = false) {
  if (viewMode !== "monitoring" || !presentationSession) return;
  const entries = getQuizMonitoringEntries(
    getActiveSessionSlots(state.slots, presentationSession.skippedSlotIds),
    presentationSession.currentSlide,
    presentationSession.slotStartedElapsedMs,
  );
  const signature = entries.map(({ slot, status }) => `${slot.id}:${status}`).join("|");
  monitoredQuizId = entries.find((entry) => entry.status === "active")?.slot.quiz.id || null;
  if (!force && signature === quizMonitoringSignature) return;
  quizMonitoringSignature = signature;
  await Promise.all(entries
    .filter((entry) => entry.status !== "upcoming" && validateQuizConfiguration(entry.slot.quiz).valid)
    .map(async ({ slot }) => quizResponseSummaries.set(slot.quiz.id, await getOwnedQuizResponseSummary(activeSessionId, slot.quiz.id))));
  if (signature === quizMonitoringSignature) renderQuizMonitoring(entries);
}

function syncPresentationSession() {
  if (!presentationSession) {
    return;
  }

  if (!activeSessionId || sessionVersion === null) {
    saveLocalSession();
    return;
  }

  const snapshot = structuredClone(presentationSession);
  const sessionId = activeSessionId;
  sessionWriteQueue = sessionWriteQueue.then(async () => {
    try {
      const savedSession = await updatePresentationSession(sessionId, snapshot, sessionVersion);
      if (activeSessionId === sessionId) {
        sessionVersion = Number(savedSession.version);
        presentationSession.version = sessionVersion;
      }
      await publishPublicRoomActivity(activeRoomToken);
    } catch (error) {
      console.error("Impossible de synchroniser la session.", error);
      const latestSession = await loadPresentationSession(sessionId);
      if (latestSession && activeSessionId === sessionId) {
        applySessionRecord(latestSession);
      }
    }
  });
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
  const pdf = await loadPdfDocument({ data: currentPdfBuffer.slice() });
  elements.pdfLoading.hidden = true;
  return pdf;
}

async function renderCurrentSlide() {
  if (!presentationSession || !currentPdfBuffer) {
    return;
  }

  const slideToRender = presentationSession.currentSlide;

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

  elements.slideCounter.textContent = `Slide ${presentationSession.currentSlide} / ${state.pageCount}`;
  elements.pdfLoading.hidden = false;
  try {
    await renderPage(
      slideToRender,
      elements.pdfCanvas,
      availableWidth,
      elements.pdfStage.clientHeight,
    );
  } finally {
    elements.pdfLoading.hidden = true;
  }
}

function getPresentationSummary() {
  const activeSessionSlots = getActiveSessionSlots(state.slots, presentationSession.skippedSlotIds);
  const slotTimings = getSlotTiming(activeSessionSlots, presentationSession.slotReductionsMs);
  const plenarySummary = validatePlenary(state.plenary, state.slots);
  const unallocatedDurationMs = plenarySummary.unallocatedMinutes * 60 * 1000;
  const totalPlannedMs = (slotTimings.at(-1)?.endOffsetMs ?? 0) + unallocatedDurationMs;
  const elapsedMs = getElapsedMs(presentationSession);
  const currentSlot = getCurrentSlot(slotTimings, presentationSession.currentSlide);
  const slotStartedElapsedMs = Number(
    presentationSession.slotStartedElapsedMs[currentSlot?.id] ?? 0,
  );
  const slotStatus = getSlotStatus(
    currentSlot,
    elapsedMs - slotStartedElapsedMs,
    presentationSession.currentSlide,
  );
  const recordedCurrentOverrunMs = Number(
    presentationSession.slotOverrunsMs[currentSlot?.id] || 0,
  );
  const totalDebtMs =
    presentationSession.accruedDebtMs - recordedCurrentOverrunMs + slotStatus.overrunMs;
  const plannedEnd = new Date();
  const [startHours, startMinutes] = state.plenary.startTime.split(":").map(Number);
  plannedEnd.setHours(startHours, startMinutes, 0, 0);
  plannedEnd.setTime(plannedEnd.getTime() + totalPlannedMs);
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
    initialDelayMs: presentationSession.initialDelayMs,
    initialAdvanceMs: presentationSession.initialAdvanceMs,
    inheritedSlotOverrunMs: 0,
    slotOverrunsMs: presentationSession.slotOverrunsMs,
    unallocatedDurationMs,
    plannedEnd,
    estimatedEnd,
    scheduleExtended,
  };
}

function renderFullscreenSlotProgress(currentSlot, slotStatus) {
  const slotProgress = currentSlot?.durationMs
    ? Math.min(100, (slotStatus.slotElapsedMs / currentSlot.durationMs) * 100)
    : 0;
  const perimeterProgress = slotProgress * 4;
  elements.fullscreenSlotProgress.style.setProperty(
    "--fullscreen-slot-progress-left",
    `${Math.min(100, perimeterProgress)}%`,
  );
  elements.fullscreenSlotProgress.style.setProperty(
    "--fullscreen-slot-progress-top",
    `${Math.min(100, Math.max(0, perimeterProgress - 100))}%`,
  );
  elements.fullscreenSlotProgress.style.setProperty(
    "--fullscreen-slot-progress-right",
    `${Math.min(100, Math.max(0, perimeterProgress - 200))}%`,
  );
  elements.fullscreenSlotProgress.style.setProperty(
    "--fullscreen-slot-progress-bottom",
    `${Math.min(100, Math.max(0, perimeterProgress - 300))}%`,
  );
  elements.fullscreenSlotProgress.style.setProperty(
    "--fullscreen-slot-progress-color",
    fullscreenSlotProgressColors[slotStatus.tone],
  );
}

function renderPresentationMetrics() {
  if (!presentationSession) {
    return;
  }

  elements.slideCounter.textContent = `Slide ${presentationSession.currentSlide} / ${state.pageCount}`;
  let presentationSummary = getPresentationSummary();
  if (presentationSummary.currentSlot && presentationSummary.slotStatus.overrunMs > 0) {
    applyOverrunStrategy(
      getActiveSessionSlots(state.slots, presentationSession.skippedSlotIds)
        .findIndex((slot) => slot.id === presentationSummary.currentSlot.id),
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
  if (viewMode === "monitoring") {
    refreshQuizMonitoring().catch((error) => console.error("Impossible de charger les résultats des quiz.", error));
  }
  const nextSlot = currentSlotIndex >= 0 ? slotTimings[currentSlotIndex + 1] : null;
  elements.sideCurrentSlotName.textContent = currentSlot?.name ?? "Hors plan";
  elements.sideCurrentSlotTime.textContent = `${formatClock(slotStatus.slotElapsedMs)} / ${formatClock(
    currentSlot?.durationMs ?? 0,
  )}`;
  elements.sideCurrentSlotStatus.textContent = slotStatus.label;
  elements.sideCurrentSlotPanel.classList.remove("status-ok", "status-warning", "status-danger");
  elements.sideCurrentSlotPanel.classList.add(`status-${slotStatus.tone}`);
  renderFullscreenSlotProgress(currentSlot, slotStatus);
  elements.fullscreenOverrun.hidden = slotStatus.overrunMs <= 0;
  elements.fullscreenOverrun.textContent = slotStatus.overrunMs > 0 ? slotStatus.label : "";
  elements.sideNextSlotName.textContent = nextSlot?.name ?? "Fin de la plénière";
  elements.sideNextSlotTime.textContent = nextSlot ? formatClock(nextSlot.durationMs) : "--:--";
  elements.timeDebt.textContent = `+${formatClock(totalDebtMs)}`;
    const sessionDelayMs = getSessionDelayMs(presentationSession, slotTimings, presentationSession.currentSlide);
    const showSessionDelay = viewMode === "monitoring" && sessionDelayMs !== null;
    elements.sessionDelayBadge.hidden = !showSessionDelay;
    if (showSessionDelay) {
      const isAhead = sessionDelayMs < 0;
      const tone = sessionDelayMs > 0 ? "danger" : isAhead ? "warning" : "ok";
      elements.sessionDelayLabel.textContent = isAhead ? "Avance" : "Retard";
      elements.sessionDelay.textContent = `${sessionDelayMs > 0 ? "+" : ""}${formatClock(Math.abs(sessionDelayMs))}`;
      elements.sessionDelayBadge.classList.remove("status-ok", "status-warning", "status-danger");
      elements.sessionDelayBadge.classList.add(`status-${tone}`);
    }
    renderRecoveryProposal(sessionDelayMs);
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

  renderTimeline({
    trackElement: elements.timelineTrack,
    markerElement: elements.nowMarker,
    slotTimings,
    elapsedMs,
    currentSlide: presentationSession.currentSlide,
    totalDebtMs,
    initialDelayMs,
    slotOverrunsMs,
    currentOverrunMs: slotStatus.overrunMs,
    totalDurationMs: totalPlannedMs,
    unallocatedDurationMs,
    slotReductionsMs: presentationSession.slotReductionsMs,
    currentSlotElapsedMs: slotStatus.slotElapsedMs,
    initialAdvanceMs,
  });
}

function startTicking() {
  stopTicking();
  tickHandle = window.setInterval(() => {
    renderPresentationMetrics();
  }, 250);
  const animateFullscreenProgress = () => {
    if (!presentationSession) {
      return;
    }
    const { currentSlot, slotStatus } = getPresentationSummary();
    renderFullscreenSlotProgress(currentSlot, slotStatus);
    fullscreenProgressAnimationHandle = window.requestAnimationFrame(animateFullscreenProgress);
  };
  fullscreenProgressAnimationHandle = window.requestAnimationFrame(animateFullscreenProgress);
}

function escapeCsvValue(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function exportPresentationReport() {
  const presentationSummary = getPresentationSummary();
  const overrunsMs = { ...presentationSession.slotOverrunsMs };
  if (presentationSummary.currentSlot && presentationSummary.slotStatus.overrunMs > 0) {
    overrunsMs[presentationSummary.currentSlot.id] = presentationSummary.slotStatus.overrunMs;
  }

  const rows = [
    ["Nom du créneau", "Temps initial", "Temps de dépassement", "Retard au démarrage de la réunion"],
    ...getActiveSessionSlots(state.slots, presentationSession.skippedSlotIds).map((slot) => [
      slot.name,
      formatClock(Number(slot.durationMinutes) * 60 * 1000),
      formatClock(Number(overrunsMs[slot.id] || 0)),
      formatClock(presentationSession.initialDelayMs),
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
  if (fullscreenProgressAnimationHandle) {
    window.cancelAnimationFrame(fullscreenProgressAnimationHandle);
    fullscreenProgressAnimationHandle = null;
  }
}

function captureCompletedSlotDebt(previousSlide, nextSlide) {
  const activeSessionSlots = getActiveSessionSlots(state.slots, presentationSession.skippedSlotIds);
  const slotTimings = getSlotTiming(activeSessionSlots, presentationSession.slotReductionsMs);
  const previousSlot = getCurrentSlot(slotTimings, previousSlide);
  const nextSlot = getCurrentSlot(slotTimings, nextSlide);

  if (!previousSlot || previousSlot.id === nextSlot?.id) {
    return;
  }

  const elapsedMs = getElapsedMs(presentationSession);
  const slotStartedElapsedMs = Number(presentationSession.slotStartedElapsedMs[previousSlot.id] ?? 0);
  const lateMs = Math.max(0, elapsedMs - slotStartedElapsedMs - previousSlot.durationMs);
  const previousLateMs = Number(presentationSession.slotOverrunsMs[previousSlot.id] || 0);
  presentationSession.slotOverrunsMs[previousSlot.id] = lateMs;
  presentationSession.accruedDebtMs += lateMs - previousLateMs;
  applyOverrunStrategy(activeSessionSlots.findIndex((slot) => slot.id === previousSlot.id));
}

function applyOverrunStrategy(completedSlotIndex, totalDebtMs = presentationSession.accruedDebtMs) {
  const plenarySummary = validatePlenary(state.plenary, state.slots);
  const activeSessionSlots = getActiveSessionSlots(state.slots, presentationSession.skippedSlotIds);
  presentationSession.slotReductionsMs = calculateSlotReductions({
    slots: activeSessionSlots,
    completedSlotIndex,
    totalDebtMs,
    unallocatedDurationMs: plenarySummary.unallocatedMinutes * 60 * 1000,
    strategy: presentationSession.overrunStrategy,
    slotReductionsMs: presentationSession.slotReductionsMs,
  });
}

async function enterPresentationMode(overrunStrategy = "next") {
  if (viewMode === "config") {
    viewMode = "presentation";
    const presentationUrl = new URL(window.location.href);
    presentationUrl.searchParams.set("view", "presentation");
    presentationUrl.searchParams.delete("sessionId");
    window.history.replaceState({}, "", presentationUrl.href);
  }
  switchView(true);
  setPresentationDetailsCollapsed(viewMode === "presentation");
  try {
    await ensurePdfLoaded();
  } catch (error) {
    switchView(false);
    throw error;
  }
  presentationSession = createSessionState(state.slots[0]?.startSlide ?? 1);
  presentationSession.overrunStrategy = overrunStrategy;

  if (!presentationSession.startedAt) {
    const plannedStart = new Date();
    const [startHours, startMinutes] = state.plenary.startTime.split(":").map(Number);
    plannedStart.setHours(startHours, startMinutes, 0, 0);
    const startDifferenceMs = Date.now() - plannedStart.getTime();
    presentationSession.initialDelayMs = Math.max(0, startDifferenceMs);
    presentationSession.initialAdvanceMs = Math.max(0, -startDifferenceMs);
    presentationSession.accruedDebtMs = presentationSession.initialDelayMs;
    applyOverrunStrategy(-1, presentationSession.initialDelayMs);
  }

  if (presentationSession.isPaused && presentationSession.pausedAt) {
    presentationSession.totalPausedMs += Date.now() - presentationSession.pausedAt;
  }
  presentationSession.isRunning = true;
  presentationSession.isPaused = false;
  presentationSession.currentSlide = Math.min(presentationSession.currentSlide || 1, state.pageCount);
  presentationSession.startedAt ??= Date.now();
  const initialSlot = getCurrentSlot(
    getSlotTiming(getActiveSessionSlots(state.slots, presentationSession.skippedSlotIds), presentationSession.slotReductionsMs),
    presentationSession.currentSlide,
  );
  if (initialSlot && presentationSession.slotStartedElapsedMs[initialSlot.id] === undefined) {
    presentationSession.slotStartedElapsedMs[initialSlot.id] = Math.max(
      getElapsedMs(presentationSession),
      presentationSession.initialAdvanceMs,
    );
  }
  presentationSession.pausedAt = null;
  presentationSession.totalPausedMs = presentationSession.totalPausedMs || 0;
  elements.pauseBtn.disabled = false;
  elements.resumeBtn.disabled = true;
  if (accessMode === "authenticated") {
    if (!state.remoteToken) {
      switchView(false);
      throw new Error("Sauvegardez ce projet avant de démarrer une session synchronisée.");
    }
    try {
      const remoteSession = await createPresentationSession(state.remoteToken, presentationSession);
      activeSessionId = remoteSession.id;
      sessionVersion = Number(remoteSession.version);
      activeRoomToken = generateRoomToken();
      await createPublicSessionRoom(activeSessionId, activeRoomToken);
      const presentationUrl = new URL(window.location.href);
      presentationUrl.searchParams.set("view", "presentation");
      presentationUrl.searchParams.set("sessionId", activeSessionId);
      window.history.replaceState({}, "", presentationUrl.href);
      stopSessionSubscription?.();
      stopSessionSubscription = subscribeToPresentationSession(activeSessionId, (updatedSession) => {
        if (Number(updatedSession.version) > sessionVersion) {
          applySessionRecord(updatedSession);
        }
      });
      renderRoomAccess();
    } catch (error) {
      if (error.code !== "P0001") throw error;
      state.remoteToken = null;
      persist();
      elements.storageStatus.textContent = "Projet distant indisponible : présentation locale";
    }
  }
  syncPresentationSession();
  renderPresentationMetrics();
  await waitForNextFrame();
  await renderCurrentSlide();
  renderPresentationMetrics();
  startTicking();
}

function leavePresentationMode() {
  const isMonitoring = viewMode === "monitoring";
  if (!isMonitoring) {
    pausePresentation();
  }
  stopSessionSubscription?.();
  stopSessionSubscription = null;
  activeSessionId = null;
  activeRoomToken = null;
  sessionVersion = null;
  stopQuestionsSubscription?.();
  stopQuestionsSubscription = null;
  stopQuizResponseEvents?.();
  stopQuizResponseEvents = null;
  sessionQuestions = [];
  selectedQuestionId = null;
  quizResponseSummaries.clear();
  quizMonitoringSignature = null;
  monitoredQuizId = null;
  selectedRecoverySlotIds.clear();
  dismissedRecoverySlide = null;
  if (!isMonitoring) {
    localStorage.removeItem(LOCAL_SESSION_KEY);
  }
  viewMode = "config";
  const configurationUrl = new URL(window.location.href);
  configurationUrl.searchParams.delete("view");
  configurationUrl.searchParams.delete("sessionId");
  window.history.replaceState({}, "", configurationUrl.href);
  switchView(false);
  stopTicking();
  presentationSession = null;
}

function nextSlide() {
  if (!presentationSession || presentationSession.currentSlide >= state.pageCount) {
    return;
  }

  const nextSlide = getNextAvailableSlide(
    state.slots,
    presentationSession.currentSlide,
    state.pageCount,
    presentationSession.skippedSlotIds,
  );
  if (nextSlide === presentationSession.currentSlide) return;
  captureCompletedSlotDebt(presentationSession.currentSlide, nextSlide);
  presentationSession.currentSlide = nextSlide;
  const nextSlot = getCurrentSlot(
    getSlotTiming(getActiveSessionSlots(state.slots, presentationSession.skippedSlotIds), presentationSession.slotReductionsMs),
    presentationSession.currentSlide,
  );
  if (nextSlot && presentationSession.slotStartedElapsedMs[nextSlot.id] === undefined) {
    presentationSession.slotStartedElapsedMs[nextSlot.id] = getElapsedMs(presentationSession);
  }
  renderCurrentSlide();
  renderPresentationMetrics();
  syncPresentationSession();
}

function previousSlide() {
  if (!presentationSession || presentationSession.currentSlide <= 1) {
    return;
  }

  const previousSlide = getNextAvailableSlide(
    state.slots,
    presentationSession.currentSlide,
    state.pageCount,
    presentationSession.skippedSlotIds,
    -1,
  );
  if (previousSlide === presentationSession.currentSlide) return;
  presentationSession.currentSlide = previousSlide;
  renderCurrentSlide();
  renderPresentationMetrics();
  syncPresentationSession();
}

function pausePresentation() {
  if (!presentationSession || presentationSession.isPaused || !presentationSession.startedAt) {
    return;
  }

  presentationSession.isPaused = true;
  presentationSession.pausedAt = Date.now();
  elements.pauseBtn.disabled = true;
  elements.resumeBtn.disabled = false;
  syncPresentationSession();
}

function resumePresentation() {
  if (!presentationSession || !presentationSession.isPaused || !presentationSession.pausedAt) {
    return;
  }

  presentationSession.totalPausedMs += Date.now() - presentationSession.pausedAt;
  presentationSession.isPaused = false;
  presentationSession.pausedAt = null;
  elements.pauseBtn.disabled = false;
  elements.resumeBtn.disabled = true;
  syncPresentationSession();
}

function resetPresentation() {
  if (!window.confirm("Reinitialiser les chronos et revenir a la slide 1 ?")) {
    return;
  }

  presentationSession = {
    ...createSessionState(state.slots[0]?.startSlide ?? 1),
    id: activeSessionId || crypto.randomUUID(),
  };
  selectedRecoverySlotIds.clear();
  dismissedRecoverySlide = null;
  elements.pauseBtn.disabled = false;
  elements.resumeBtn.disabled = true;
  persist();
  syncPresentationSession();
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
  presentationSession = null;
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

  const requestId = ++pdfImportRequestId;
  try {
    elements.storageStatus.textContent = "Analyse du PDF en cours...";
    setImportProgress(5, "Initialisation de l'import...");
    const buffer = await readFileAsArrayBuffer(file);
    if (requestId !== pdfImportRequestId) {
      return;
    }
    const pdfBuffer = new Uint8Array(buffer);
    const pdfSourceBuffer = pdfBuffer.slice();

    setImportProgress(72, "Analyse du document PDF...");
    const pdf = await loadPdfDocument({ data: pdfBuffer });
    if (requestId !== pdfImportRequestId) {
      return;
    }
    currentPdfBuffer = pdfSourceBuffer;
    state.pdfName = file.name;
    state.pageCount = pdf.numPages;
    presentationSession = null;

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
    if (requestId !== pdfImportRequestId) {
      return;
    }
    currentPdfBuffer = null;
    hideImportProgress();
    throw error;
  }
}

function attachEvents() {
  elements.googleSignInBtn.addEventListener("click", handleGoogleSignIn);
  elements.sandboxBtn.addEventListener("click", enterSandbox);
  elements.signOutBtn.addEventListener("click", handleSignOut);
  elements.homeAccessBtn.addEventListener("click", () => {
    if (accessMode === "sandbox") {
      showAccessScreen();
    }
  });
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

  elements.addSlotBtn.addEventListener("click", openSlotWizard);
  elements.closeSlotWizardBtn.addEventListener("click", closeSlotWizard);
  document.querySelectorAll('input[name="slotWizardType"]').forEach((input) => {
    input.addEventListener("change", () => {
      slotWizard.type = input.value;
      elements.slotWizardTypeNextBtn.disabled = false;
    });
  });
  elements.slotWizardTypeNextBtn.addEventListener("click", () => {
    if (!slotWizard.type) {
      setSlotWizardError(elements.slotWizardTypeError, "Choisissez un type de créneau.");
    } else if (slotWizard.type === "presentation") {
      elements.slotWizardTypeStep.hidden = true;
      elements.slotWizardStructureStep.hidden = false;
    } else {
      showSlotWizardDetails();
    }
  });
  elements.slotWizardStructureBackBtn.addEventListener("click", () => {
    elements.slotWizardTypeStep.hidden = false;
    elements.slotWizardStructureStep.hidden = true;
  });
  elements.slotWizardStructureNextBtn.addEventListener("click", () => {
    slotWizard.structure = document.querySelector('input[name="slotWizardStructure"]:checked').value;
    showSlotWizardDetails();
  });
  elements.slotWizardDetailsBackBtn.addEventListener("click", () => {
    elements.slotWizardDetailsStep.hidden = true;
    if (slotWizard.type === "presentation") {
      elements.slotWizardStructureStep.hidden = false;
    } else {
      elements.slotWizardTypeStep.hidden = false;
    }
  });
  elements.slotWizardEndSlide.addEventListener("input", renderSlotWizardPreview);
  elements.slotWizardDuration.addEventListener("input", renderSlotWizardPreview);
  elements.slotWizardCreateBtn.addEventListener("click", createSlotsFromWizard);

  elements.slotsList.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return;
    }
    if (target.dataset.quizField === "question") {
      updateQuizSlot(target.dataset.quizSlotId, "question", target.value);
      return;
    }
    if (target.dataset.quizOptionId) {
      updateQuizSlot(target.dataset.quizSlotId, "option", { id: target.dataset.quizOptionId, label: target.value });
      return;
    }
    if (target.dataset.field !== "optional") {
      updateSlot(target.dataset.slotId, target.dataset.field, target.value, true);
    }
  });

  elements.slotsList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return;
    }
    if (target.dataset.quizField) {
      updateQuizSlot(target.dataset.quizSlotId, target.dataset.quizField, target.value);
      return;
    }
    if (target.dataset.quizOptionId) {
      updateQuizSlot(target.dataset.quizSlotId, "option", { id: target.dataset.quizOptionId, label: target.value });
      return;
    }
    if (target.dataset.field === "optional") {
      updateSlot(target.dataset.slotId, target.dataset.field, target.checked);
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
  elements.strategyDialog.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.value !== "confirm") {
      return;
    }
    const selectedStrategy = document.querySelector('input[name="overrunStrategy"]:checked');
    const monitoringUrl = new URL(window.location.href);
    monitoringUrl.searchParams.set("view", "monitoring");
    monitoringUrl.searchParams.delete("sessionId");
    const monitoringWindow = window.open(
      monitoringUrl.href,
      `timekeeper-monitoring-${crypto.randomUUID()}`,
    );
    enterPresentationMode(selectedStrategy?.value || "next").then(() => {
      if (activeSessionId) {
        openMonitoringView(activeSessionId, monitoringWindow);
      }
    }).catch((error) => {
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
  elements.publicQuestionForm.addEventListener("submit", submitPublicQuestion);
  elements.publicQuestionsList.addEventListener("submit", updatePublicQuestion);
  elements.publicQuestionsList.addEventListener("click", (event) => {
    const editQuestionId = event.target.closest("[data-edit-public-question-id]")?.dataset.editPublicQuestionId;
    if (editQuestionId) {
      editingPublicQuestionId = editQuestionId;
      renderPublicParticipantQuestions();
      elements.publicQuestionsList.querySelector("textarea")?.focus();
      return;
    }
    const closeQuestionId = event.target.closest("[data-close-public-question-editor]")?.dataset.closePublicQuestionEditor;
    if (closeQuestionId) {
      editingPublicQuestionId = null;
      renderPublicParticipantQuestions();
      return;
    }
    const questionId = event.target.closest("[data-cancel-public-question-id]")?.dataset.cancelPublicQuestionId;
    if (questionId) cancelPublicQuestion(questionId);
  });
  elements.publicQuizForm.addEventListener("submit", submitPublicQuiz);
  elements.publicQuizOptions.addEventListener("change", () => {
    const selected = elements.publicQuizOptions.querySelector("input:checked");
    publicQuizSelection = selected?.value || null;
    elements.publicQuizSubmit.disabled = !publicQuizSelection;
  });
  elements.recoverySlots.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.checked) selectedRecoverySlotIds.add(target.value); else selectedRecoverySlotIds.delete(target.value);
    renderPresentationMetrics();
  });
  elements.keepRecoveryPlanBtn.addEventListener("click", keepRecoveryPlan);
  elements.skipRecoverySlotsBtn.addEventListener("click", skipSelectedRecoverySlots);
  elements.questionsList.addEventListener("click", (event) => {
      const questionButton = event.target.closest("[data-question-id]");
      if (!questionButton) {
        return;
      }
      selectedQuestionId = questionButton.dataset.questionId;
      renderQuestions();
    });
    elements.answerQuestionBtn.addEventListener("click", () => updateSelectedQuestionStatus("answered"));
    elements.dismissQuestionBtn.addEventListener("click", () => updateSelectedQuestionStatus("dismissed"));
  elements.resetBtn.addEventListener("click", resetPresentation);
  elements.clearConfigBtn.addEventListener("click", clearConfiguration);
  elements.tutorialBtn.addEventListener("click", openTutorial);
  elements.closeTutorialBtn.addEventListener("click", closeTutorial);
  elements.tutorialPreviousBtn.addEventListener("click", () => goToTutorialStep(-1));
  elements.tutorialNextBtn.addEventListener("click", () => goToTutorialStep(1));
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
    if (!elements.tutorialOverlay.hidden) {
      const target = document.querySelector(".tutorial-target");
      if (target) {
        positionTutorialShades(target);
        positionTutorialTooltip(target, tutorialSteps[tutorialStepIndex].tooltipPlacement);
      }
    }
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
    if (!elements.tutorialOverlay.hidden) {
      if (event.key === "Escape") {
        closeTutorial();
      } else if (event.key === "ArrowRight") {
        goToTutorialStep(1);
      } else if (event.key === "ArrowLeft") {
        goToTutorialStep(-1);
      }
      return;
    }

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
      if (presentationSession?.isPaused) {
        resumePresentation();
      } else {
        pausePresentation();
      }
    } else if (event.key.toLowerCase() === "f" || event.key === "F11") {
      event.preventDefault();
      elements.fullscreenBtn.click();
    }
  });
}

async function bootstrap() {
  if (publicRoomToken) {
    attachEvents();
    await loadPublicRoom(publicRoomToken);
    return;
  }

  attachEvents();
  renderConfiguration();
  hasUnsavedChanges = false;
  updateSaveButton();
  if (state.remoteToken) {
    elements.storageStatus.textContent = "Projet synchronisé";
  } else if (state.pdfName) {
    elements.storageStatus.textContent = "Configuration locale active";
  }

  initAuth({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    redirectTo: new URL("./", window.location.href).href,
  });

  let user = null;
  try {
    user = await getCurrentUser();
  } catch (error) {
    console.error("Impossible de restaurer la session Supabase.", error);
  }
  if (activeSessionId) {
    if (!user) {
      showAccessScreen();
      elements.accessError.textContent = "Connectez-vous avec le compte propriétaire pour ouvrir cette session.";
      elements.accessError.hidden = false;
    } else {
      const accessToken = await getCurrentAccessToken();
      showApplication("authenticated", user, accessToken);
      await joinPresentationSession(activeSessionId);
    }
  } else if (viewMode === "monitoring") {
    showApplication(user ? "authenticated" : "sandbox", user, user ? await getCurrentAccessToken() : null);
    switchView(true);
    setPresentationDetailsCollapsed(false);
    loadLocalSession();
  } else if (user) {
    showApplication("authenticated", user, await getCurrentAccessToken());
  } else {
    showAccessScreen();
  }

  try {
    onAuthStateChange((_event, nextSession) => {
      if (nextSession) {
        showApplication("authenticated", nextSession.user, nextSession.access_token);
      } else if (accessMode === "authenticated") {
        showAccessScreen();
      }
    });
  } catch (error) {
    console.error("Impossible d'écouter la session Supabase.", error);
  }

  window.addEventListener("storage", (event) => {
    if (event.key === LOCAL_SESSION_KEY && event.newValue && !activeSessionId) {
      loadLocalSession();
    }
  });
}

bootstrap().catch(console.error);
