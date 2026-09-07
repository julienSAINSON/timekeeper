export const QUESTION_MAX_LENGTH = 500;
export const QUESTION_STATUSES = ["pending", "answered", "dismissed", "cancelled"];

export function normalizeQuestionText(value) {
  return String(value || "").trim();
}

export function validateQuestionText(value) {
  const text = normalizeQuestionText(value);
  if (!text) {
    return { valid: false, text, error: "Saisissez une question." };
  }
  if (text.length > QUESTION_MAX_LENGTH) {
    return {
      valid: false,
      text,
      error: `Une question ne peut pas dépasser ${QUESTION_MAX_LENGTH} caractères.`,
    };
  }
  return { valid: true, text, error: "" };
}

export function isQuestionStatus(value) {
  return QUESTION_STATUSES.includes(value);
}

export function getQuestionStatusLabel(status) {
  return {
    pending: "En attente",
    answered: "Traitée",
    dismissed: "Écartée",
    cancelled: "Annulée",
  }[status] || "Inconnu";
}

export function formatQuestionTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "À l'instant"
    : date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
