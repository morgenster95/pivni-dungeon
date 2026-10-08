// Demo režim: náhrada firebase/app.
export function initializeApp(config) { return { name: '[DEFAULT]', options: config, demo: true }; }
export function getApp() { return { name: '[DEFAULT]', demo: true }; }
