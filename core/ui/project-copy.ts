import { uiCopy } from './copy.ts';

type Resolved<T> = T extends string ? string : T extends (...args: infer A) => infer R ? (...args: A) => R : T extends object ? { [K in keyof T]: Resolved<T[K]> } : T;
export type UiCopy = Resolved<typeof uiCopy>;
/** Presentation headings and navigation only. Rule, outcome, budget, failure and action semantics are protected. */
export const COPY_OVERRIDE_PATHS = ['hero','lede','local','localDetail','setup','setupDetail','build','buildLede','correct','correctLede','health','helpTitle','nav.home','nav.runs','nav.build','nav.correct','nav.health','nav.help'] as const;
const paths = new Set<string>(COPY_OVERRIDE_PATHS);
export interface CopyIssue { path: string; detail: string }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && !/[<>]/.test(value) && !/\b(?:fast|filed)\b/i.test(value);
export function validateProjectCopy(value: unknown): CopyIssue[] {
  if (!record(value)) return [{path: 'productName', detail: uiCopy.invalidProjectCopy}];
  const issues: CopyIssue[] = [];
  if (!safeText(value.productName)) issues.push({path: 'productName', detail: uiCopy.invalidProjectCopy});
  if (value.copyOverrides !== undefined) {
    if (!record(value.copyOverrides)) issues.push({path: 'copyOverrides', detail: uiCopy.invalidProjectCopy});
    else for (const [key, text] of Object.entries(value.copyOverrides)) {
      if (!paths.has(key) || !safeText(text)) issues.push({path: 'copyOverrides.' + key, detail: uiCopy.invalidProjectCopy});
    }
  }
  return issues;
}
export function resolveProjectCopy(value: unknown): UiCopy {
  const issues = validateProjectCopy(value);
  if (issues.length) throw Object.assign(new Error(uiCopy.invalidProjectCopy), {code: 'E_PROJECT_COPY', issues});
  const metadata = value as {productName: string; copyOverrides?: Record<string, string>};
  const result: UiCopy = {...uiCopy, product: metadata.productName, nav: {...uiCopy.nav}};
  for (const [path, text] of Object.entries(metadata.copyOverrides ?? {})) {
    if (path.startsWith('nav.')) (result.nav as Record<string,string>)[path.slice(4)] = text;
    else (result as unknown as Record<string,unknown>)[path] = text;
  }
  return result;
}
export let activeUiCopy: UiCopy = uiCopy;
export function configureProjectCopy(value: unknown): void { activeUiCopy = resolveProjectCopy(value); }

