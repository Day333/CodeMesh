import type { CodeMeshApi } from "../shared/types";

declare global {
  interface Window {
    codemesh: CodeMeshApi;
  }
}

export {};
