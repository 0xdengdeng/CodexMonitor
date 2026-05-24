/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_COMMIT_HASH__: string;
declare const __APP_BUILD_DATE__: string;
declare const __APP_GIT_BRANCH__: string;
declare const __APP_IS_DEV_BUILD__: boolean;

declare module "monaco-editor/esm/vs/editor/editor.api.js" {
  export * from "monaco-editor";
}
