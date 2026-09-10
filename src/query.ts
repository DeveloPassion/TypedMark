import { readCollectionModel } from "./validator";
import { SchemaRegistry } from "./schema-registry";
import { readStableCollection, SnapshotChangedError } from "./snapshot";
import { evaluateQuery, parseQuery, QueryError, QUERY_VERSION, type QueryResult } from "./query-engine";
export { QueryError, QUERY_VERSION } from "./query-engine";
export type { QueryResult } from "./query-engine";

export interface QueryInput {
  collectionRoot: string;
  schemaDirectory: string;
  queryVersion: string;
  query: unknown;
}

export function queryCollection(input: QueryInput): QueryResult {
  if (input.queryVersion !== QUERY_VERSION) throw new QueryError("QRY-2", "An explicit supported exact query-contract version is required");
  const query = parseQuery(input.query, new SchemaRegistry(input.schemaDirectory));
  try {
    const model = readStableCollection(input.collectionRoot, (snapshotRoot) => readCollectionModel({ ...input, collectionRoot: snapshotRoot }));
    return evaluateQuery(model, query);
  } catch (error) {
    if (error instanceof SnapshotChangedError) throw new QueryError("CM-305", error.message);
    throw error;
  }
}
