/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_GEMINI_API_KEY?: string;
  readonly VITE_ADMIN_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
