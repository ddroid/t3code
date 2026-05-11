/**
 * DevinAdapter — shape type for the Devin provider adapter.
 *
 * Bundles the ACP-over-stdio session/turn runtime for Devin CLI.
 *
 * @module DevinAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * DevinAdapterShape — per-instance Devin adapter contract.
 */
export interface DevinAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
