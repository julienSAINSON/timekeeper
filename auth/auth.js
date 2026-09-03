import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let supabaseClient = null;
let authConfig = null;

/**
 * Initialise le client Supabase de l'application qui utilise ce module.
 * N'utilisez jamais une Service Role Key dans cette configuration navigateur.
 *
 * @param {object} config
 * @param {string} config.supabaseUrl
 * @param {string} [config.supabaseAnonKey]
 * @param {string} [config.supabasePublishableKey]
 * @param {string} [config.redirectTo]
 * @param {string} [config.loginPage]
 * @returns {object} Le client Supabase initialisé.
 */
export function initAuth(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('initAuth requiert un objet de configuration.');
  }

  const { supabaseUrl, supabaseAnonKey, supabasePublishableKey, redirectTo, loginPage } = config;
  const publicKey = supabaseAnonKey || supabasePublishableKey;

  if (!supabaseUrl || !publicKey) {
    throw new Error(
      'La configuration Supabase doit contenir supabaseUrl et supabaseAnonKey ou supabasePublishableKey.'
    );
  }

  authConfig = {
    redirectTo: redirectTo || window.location.href,
    loginPage: loginPage || null,
  };
  supabaseClient = createClient(supabaseUrl, publicKey);

  return supabaseClient;
}

/**
 * Ouvre le flux OAuth Google configuré dans Supabase.
 * @returns {Promise<void>}
 */
export async function loginWithGoogle() {
  const client = getClient();
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: authConfig.redirectTo },
  });

  if (error) {
    throw new Error(`La connexion Google a échoué : ${error.message}`);
  }
}

/**
 * Termine la session locale Supabase.
 * @returns {Promise<void>}
 */
export async function logout() {
  const { error } = await getClient().auth.signOut();

  if (error) {
    throw new Error(`La déconnexion a échoué : ${error.message}`);
  }
}

/**
 * Retourne l'utilisateur connecté, ou null lorsque la session est absente.
 * @returns {Promise<object|null>}
 */
export async function getCurrentUser() {
  const { data, error } = await getClient().auth.getUser();

  if (error) {
    // Une session expirée ne doit pas être traitée comme un utilisateur connecté.
    if (error.name === 'AuthSessionMissingError') {
      return null;
    }
    throw new Error(`Impossible de récupérer l'utilisateur : ${error.message}`);
  }

  return data.user;
}

/**
 * Exige une session. Retourne l'utilisateur, ou null et redirige vers loginPage.
 * Passez { redirect: false } pour afficher un écran de connexion dans la page courante.
 *
 * @param {object} [options]
 * @param {boolean} [options.redirect=true]
 * @param {string|null} [options.loginPage]
 * @returns {Promise<object|null>}
 */
export async function requireAuth({ redirect = true, loginPage = authConfig?.loginPage } = {}) {
  const user = await getCurrentUser();

  if (!user && redirect && loginPage) {
    window.location.assign(loginPage);
  }

  return user;
}

/**
 * Abonne l'application aux connexions, déconnexions et mises à jour de session.
 * @param {(event: string, session: object|null) => void} callback
 * @returns {() => void} Fonction de désabonnement.
 */
export function onAuthStateChange(callback) {
  if (typeof callback !== 'function') {
    throw new Error('onAuthStateChange requiert une fonction de rappel.');
  }

  const { data } = getClient().auth.onAuthStateChange(callback);
  return () => data.subscription.unsubscribe();
}

function getClient() {
  if (!supabaseClient) {
    throw new Error('Le module auth n\'est pas initialisé. Appelez initAuth(config) avant cette fonction.');
  }

  return supabaseClient;
}