declare const __APP_VERSION__: string | undefined;

/** Injected at build time from the root package.json (see tsup.config.ts). */
export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
