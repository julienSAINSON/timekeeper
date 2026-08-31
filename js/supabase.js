const SUPABASE_URL = "https://nozwjovvfcosmskzneoq.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vendqb3Z2ZmNvc21za3puZW9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxNjUwOTUsImV4cCI6MjEwMzc0MTA5NX0.7DKIlTHWuIx1xwg1E47_l9IpEjn1-8ItTg9xdnMejZg";
const PROJECT_INDEX_KEY = "safe-timekeeper-project-index-v1";

function sharedState(state) {
  const { remoteToken, ...stateToShare } = state;
  return stateToShare;
}

async function callRpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "La synchronisation Supabase a échoué.");
  }

  return response.status === 204 ? null : response.json();
}

export function getSharedTokenFromUrl() {
  return new URLSearchParams(window.location.search).get("plenary");
}

export function getSharedUrl(token) {
  const url = new URL(window.location.href);
  url.searchParams.set("plenary", token);
  return url.toString();
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

export function rememberProject(token, projectName) {
  const projects = getKnownProjects().filter((project) => project.token !== token);
  projects.unshift({
    token,
    name: projectName || "Plénière sans nom",
    lastOpenedAt: new Date().toISOString(),
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