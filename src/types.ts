export type ExtensionMap = Record<string, string>;

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
}

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
}

export interface ValidateCollectionInput {
  collectionRoot: string;
  schemaDirectory: string;
  referenceEdition?: string;
  mode?: ValidationMode;
  supportedExtensions?: ExtensionMap;
}
