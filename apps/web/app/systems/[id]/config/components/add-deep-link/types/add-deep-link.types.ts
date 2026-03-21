/**
 * Types for AddDeepLinkDialog component
 * Re-exports shared types from edit-deep-link
 */

// Re-export shared types from edit-deep-link
export type {
  DeepLinkFormData,
  VariableDefinition,
  AutocompleteState,
} from '../../edit-deep-link/types';

export {
  BASE_VARIABLES,
  URL_EXAMPLES,
} from '../../edit-deep-link/types';

/**
 * Props for AddDeepLinkDialog component
 */
export interface AddDeepLinkDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (deepLink: {
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    name: string;
    url: string;
  }) => Promise<void>;
  systemId: string;
  systemName: string;
  testEnvironment: string;
  workload: string;
  loading: boolean;
}
