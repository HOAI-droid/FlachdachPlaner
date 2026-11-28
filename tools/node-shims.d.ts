// Minimale Typen für die Node-Module der Pack-Werkzeuge (bewusst ohne @types/node).
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string, encoding: "utf8"): void;
  export function statSync(path: string): { size: number };
}
declare const process: { argv: string[]; exit(code?: number): never };
