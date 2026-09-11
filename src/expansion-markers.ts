import { parseBodyRegions, type BodyRegion } from "./body-regions";

export type ExpansionMarker = Pick<BodyRegion, "descriptor" | "region" | "line">;
export interface MarkerFailure { rule: string; message: string; expansion?: string }

export function parseExpansions(body: string) {
  const parsed = parseBodyRegions(body, "expansion");
  return {
    used: parsed.used, expansions: parsed.regions.map(({ endLine, ...region }): ExpansionMarker => region),
    failures: parsed.failures.map(({ id, rule, message }): MarkerFailure => ({ rule,
      message: message.replace(/^Region /, "Expansion ").replace(/^Duplicate region /, "Duplicate expansion ").replace(/^expansion regions /, "Content expansions "),
      ...(id ? { expansion: id } : {}),
    })),
  };
}
