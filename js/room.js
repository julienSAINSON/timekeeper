const ROOM_TOKEN_BYTES = 32;
const ROOM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateRoomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_TOKEN_BYTES));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function isRoomToken(value) {
  return ROOM_TOKEN_PATTERN.test(value);
}

export function getRoomPath(roomToken) {
  if (!isRoomToken(roomToken)) {
    throw new Error("Token de Room invalide.");
  }
  return `/r/${roomToken}`;
}

export function getPublicRoomUrl(roomToken, locationHref = window.location.href) {
  const url = new URL(locationHref);
  url.pathname = `${url.pathname.replace(/\/[^/]*$/, "")}${getRoomPath(roomToken)}`;
  url.search = "";
  url.hash = "";
  return url.href;
}

export function getRoomTokenFromPath(pathname = window.location.pathname) {
  const roomMatch = pathname.match(/\/r\/([^/]+)\/?$/);
  return roomMatch && isRoomToken(roomMatch[1]) ? roomMatch[1] : null;
}
