import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabaseConfig.js?v=access-v1";
import { getSupabaseClient } from "../auth/auth.js";

const PROJECT_INDEX_KEY = "safe-timekeeper-project-index-v1";
let authAccessToken = null;

export function setAuthAccessToken(accessToken) {
  authAccessToken = accessToken || null;
  if (authAccessToken) {
    getSupabaseClient().realtime.setAuth(authAccessToken);
  }
}

function sharedState(state) {
  const { remoteToken, ...stateToShare } = state;
  return stateToShare;
}

async function callRpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${authAccessToken || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseText = await response.text();
    let errorBody = null;
    try {
      errorBody = JSON.parse(responseText);
    } catch {}
    const error = new Error(errorBody?.message || responseText || "La synchronisation Supabase a échoué.");
    error.code = errorBody?.code || null;
    throw error;
  }

  return response.status === 204 ? null : response.json();
}

export async function createSharedPlenary(state) {
  return callRpc("create_shared_plenary", { p_state: sharedState(state) });
}

export async function loadSharedPlenary(token) {
  return callRpc("get_shared_plenary", { p_share_token: token });
}

export async function saveSharedPlenary(token, state) {
  await callRpc("update_shared_plenary", {
    p_share_token: token,
    p_state: sharedState(state),
  });
}

export function getKnownProjects() {
  try {
    const projects = JSON.parse(localStorage.getItem(PROJECT_INDEX_KEY) || "[]");
    return Array.isArray(projects) ? projects : [];
  } catch (error) {
    console.warn("Impossible de charger la liste des projets.", error);
    return [];
  }
}

export function rememberProject(token, projectName, ownerUserId = null) {
  const projects = getKnownProjects().filter((project) => project.token !== token);
  projects.unshift({
    token,
    name: projectName || "Plénière sans nom",
    lastOpenedAt: new Date().toISOString(),
    ownerUserId: ownerUserId || null,
  });
  localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(projects.slice(0, 30)));
}

export async function deleteSharedPlenary(token) {
  await callRpc("delete_shared_plenary", { p_share_token: token });
}

export function forgetProject(token) {
  const projects = getKnownProjects().filter((project) => project.token !== token);
  localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(projects));
}

export function createPresentationSession(projectToken, session) {
  return callRpc("create_presentation_session", {
    p_share_token: projectToken,
    p_session_id: session.id,
    p_state: session,
  });
}

export function loadPresentationSession(sessionId) {
  return callRpc("get_presentation_session", { p_session_id: sessionId });
}

export function updatePresentationSession(sessionId, session, expectedVersion) {
  return callRpc("update_presentation_session", {
    p_session_id: sessionId,
    p_state: session,
    p_expected_version: expectedVersion,
  });
}

export function createPublicSessionRoom(sessionId, roomToken) {
  return callRpc("create_public_session_room", {
    p_session_id: sessionId,
    p_room_token: roomToken,
  });
}

export function loadPublicSessionRoom(roomToken) {
  return callRpc("get_public_session_room", { p_room_token: roomToken });
}

export function loadOwnedPublicSessionRoom(sessionId) {
  return callRpc("get_owned_public_session_room", { p_session_id: sessionId });
}

export function createPublicSessionQuestion(roomToken, participantId, text) {
  return callRpc("create_public_session_question", {
    p_room_token: roomToken,
    p_participant_id: participantId,
    p_text: text,
  });
}

export function loadPublicParticipantQuestions(roomToken, participantId) {
  return callRpc("get_public_participant_questions", {
    p_room_token: roomToken,
    p_participant_id: participantId,
  });
}

export function updatePublicParticipantQuestion(roomToken, participantId, questionId, text) {
  return callRpc("update_public_participant_question", {
    p_room_token: roomToken,
    p_participant_id: participantId,
    p_question_id: questionId,
    p_text: text,
  });
}

export function cancelPublicParticipantQuestion(roomToken, participantId, questionId) {
  return callRpc("cancel_public_participant_question", {
    p_room_token: roomToken,
    p_participant_id: participantId,
    p_question_id: questionId,
  });
}

export function loadOwnedSessionQuestions(sessionId) {
  return callRpc("get_owned_session_questions", { p_session_id: sessionId });
}

export function updateOwnedSessionQuestionStatus(questionId, status) {
  return callRpc("update_owned_session_question_status", {
    p_question_id: questionId,
    p_status: status,
  });
}

export function subscribeToPresentationSession(sessionId, onUpdate) {
  const realtimeClient = getSupabaseClient();
  const channel = realtimeClient
    .channel(`presentation-session:${sessionId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "tk_presentation_sessions",
        filter: `id=eq.${sessionId}`,
      },
      ({ new: session }) => onUpdate(session),
    )
    .subscribe();

  return () => realtimeClient.removeChannel(channel);
}

export function subscribeToSessionQuestions(sessionId, onInsert, onUpdate) {
  const realtimeClient = getSupabaseClient();
  const channel = realtimeClient
    .channel(`session-questions:${sessionId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "tk_session_questions",
        filter: `session_id=eq.${sessionId}`,
      },
      ({ new: question }) => onInsert(question),
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "tk_session_questions",
        filter: `session_id=eq.${sessionId}`,
      },
      ({ new: question }) => onUpdate(question),
    )
    .subscribe();

  return () => realtimeClient.removeChannel(channel);
}

export function getPublicRoomActivity(roomToken, participantId) {
  return callRpc("get_public_room_activity", { p_room_token: roomToken, p_participant_id: participantId });
}

export function submitPublicQuizResponse(roomToken, participantId, optionId) {
  return callRpc("submit_public_quiz_response", {
    p_room_token: roomToken, p_participant_id: participantId, p_option_id: optionId,
  });
}

export function getOwnedQuizResponseSummary(sessionId, quizId) {
  return callRpc("get_owned_quiz_response_summary", {
    p_session_id: sessionId, p_quiz_id: quizId,
  });
}

export function subscribeToPublicRoomActivity(roomToken, onActivity) {
  const client = getSupabaseClient();
  const channel = client.channel(`room-activity:${roomToken}`, { config: { private: false } })
    .on("broadcast", { event: "activity" }, onActivity).subscribe();
  return () => client.removeChannel(channel);
}

export async function publishPublicRoomActivity(roomToken) {
  if (!roomToken) return;
  const channel = getSupabaseClient().channel(`room-activity:${roomToken}`, { config: { private: false } });
  await channel.subscribe();
  await channel.send({ type: "broadcast", event: "activity", payload: {} });
  await getSupabaseClient().removeChannel(channel);
}

export function subscribeToQuizResponseEvents(sessionId, onInsert) {
  const channel = getSupabaseClient().channel(`quiz-response-events:${sessionId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "tk_quiz_response_events", filter: `session_id=eq.${sessionId}` },
      onInsert,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "tk_quiz_response_events", filter: `session_id=eq.${sessionId}` },
      onInsert,
    )
    .subscribe();
  return () => getSupabaseClient().removeChannel(channel);
}