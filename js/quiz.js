export const QUIZ_OPTION_MIN = 2;
export const QUIZ_OPTION_MAX = 4;

export function normalizeQuizDraft(question, optionLabels) {
  const cleanQuestion = String(question || "").trim();
  const options = optionLabels.map((label, index) => ({
    id: String.fromCharCode(65 + index),
    label: String(label || "").trim(),
  })).filter((option) => option.label);
  return { question: cleanQuestion, options };
}

export function validateQuizDraft(question, optionLabels) {
  const quiz = normalizeQuizDraft(question, optionLabels);
  if (!quiz.question) return { valid: false, quiz, error: "Saisissez la question du quiz." };
  if (quiz.options.length < QUIZ_OPTION_MIN || quiz.options.length > QUIZ_OPTION_MAX) {
    return { valid: false, quiz, error: "Ajoutez entre 2 et 4 propositions." };
  }
  return { valid: true, quiz, error: "" };
}

export function getParticipantId() {
  const key = "safe-timekeeper-participant-id-v1";
  let participantId = localStorage.getItem(key);
  if (!participantId) {
    participantId = crypto.randomUUID();
    localStorage.setItem(key, participantId);
  }
  return participantId;
}
