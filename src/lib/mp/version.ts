/** Multiplayer data version = app version: every player in a room must have identical bundled data. */
export const DATA_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
