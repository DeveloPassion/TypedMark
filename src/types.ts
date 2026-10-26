export type ExtensionMap = Record<string, string>;

/** Relationship kinds in declaration order; body links only feed `related_to` (RHT-7). */
export const RELATIONSHIP_KINDS = ["belongs_to", "related_to", "contains", "depends_on"] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export type ValidationMode = "system_definition" | "instantiated_collection" | "both";
export type Evaluation = "complete" | "incomplete";
export type Severity = "error" | "warn" | "info";

export interface ValidationResult {
  code: string;
  severity: Severity;
  path: string;
  rule_id: string;
  message: string;
  note_type?: string;
  field?: string;
  relationship?: string;
  heading?: string;
  expansion?: string;
  dataset?: string;
  view?: string;
  template_region?: string;
  drift_kind?: string;
  extension?: string;
  fix?: FixAction;
}

/** One automation action that repairs a finding; validation never applies it (CR-110, CR-113). */
export type FixAction =
  | { kind: "set_field"; field: string; value: unknown }
  | { kind: "unset_field"; field: string }
  | { kind: "add_tag"; tag: string }
  | { kind: "move_note"; path: string };

export interface ValidationReport {
  specification_version: string;
  mode: ValidationMode;
  evaluation: Evaluation;
  required_extensions: ExtensionMap;
  evaluated_extensions: ExtensionMap;
  valid: boolean;
  results: ValidationResult[];
}

export interface AdapterCapabilities {
  core: Record<string, string>;
  extensions: ExtensionMap;
  operations: ExtensionMap;
}

export interface ValidateCollectionInput {
  collectionRoot: string;
  schemaDirectory: string;
  /** Requested report edition; only the implemented 0.1.0 edition is accepted. */
  referenceEdition?: string;
  mode?: ValidationMode;
  supportedExtensions?: ExtensionMap;
}
