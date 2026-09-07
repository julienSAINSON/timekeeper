export const QUIZ_OPTION_MIN = 2;
export const QUIZ_OPTION_MAX = 4;
export const QUIZ_OPTION_IDS = ["A", "B", "C", "D"];

export function createQuizConfiguration() {
  return {
    id: crypto.randomUUID(),
    question: "",
    options: QUIZ_OPTION_IDS.map((id) => ({ id, label: "" })),
    correctOptionId: "",
  };
}

export function normalizeQuizConfiguration(rawQuiz) {
  const emptyQuiz = createQuizConfiguration();
  if (!rawQuiz || typeof rawQuiz !== "object") {
    return emptyQuiz;
  }

  const labelsById = new Map(
    Array.isArray(rawQuiz.options)
      ? rawQuiz.options
        .filter((option) => QUIZ_OPTION_IDS.includes(option?.id))
        .map((option) => [option.id, typeof option.label === "string" ? option.label : ""])
      : [],
  );
  const options = QUIZ_OPTION_IDS.map((id) => ({ id, label: labelsById.get(id) || "" }));
  const correctOptionId = typeof rawQuiz.correctOptionId === "string" ? rawQuiz.correctOptionId : "";
  return {
    id: typeof rawQuiz.id === "string" && rawQuiz.id ? rawQuiz.id : emptyQuiz.id,
    question: typeof rawQuiz.question === "string" ? rawQuiz.question : "",
    options,
    correctOptionId: options.some((option) => option.id === correctOptionId && option.label.trim())
      ? correctOptionId
      : "",
  };
}

export function validateQuizConfiguration(rawQuiz) {
  const quiz = normalizeQuizConfiguration(rawQuiz);
  const question = quiz.question.trim();
  const options = quiz.options
    .map((option) => ({ ...option, label: option.label.trim() }))
    .filter((option) => option.label);
  const hasUniqueOptionIds = new Set(options.map((option) => option.id)).size === options.length;
  const validCorrectOption = options.some((option) => option.id === quiz.correctOptionId);

  if (!question) return { valid: false, quiz: { ...quiz, question, options }, error: "Saisissez la question du quiz." };
  if (options.length < QUIZ_OPTION_MIN || options.length > QUIZ_OPTION_MAX || !hasUniqueOptionIds) {
    return { valid: false, quiz: { ...quiz, question, options }, error: "Ajoutez entre 2 et 4 propositions distinctes." };
  }
  if (!validCorrectOption) return { valid: false, quiz: { ...quiz, question, options }, error: "Choisissez une bonne réponse renseignée." };
  return { valid: true, quiz: { ...quiz, question, options }, error: "" };
}

export function normalizePublicQuizActivity(activity) {
  const quiz = activity?.quiz;
  if (!quiz || typeof quiz !== "object" || typeof quiz.id !== "string" || !quiz.id || typeof quiz.question !== "string" || !Array.isArray(quiz.options)) {
    return null;
  }
  const options = quiz.options
    .filter((option) => QUIZ_OPTION_IDS.includes(option?.id) && typeof option.label === "string" && option.label.trim())
    .map((option) => ({ id: option.id, label: option.label }));
  return options.length >= QUIZ_OPTION_MIN && options.length <= QUIZ_OPTION_MAX
    ? { id: quiz.id, question: quiz.question, options, hasResponded: quiz.hasResponded === true }
    : null;
}

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
