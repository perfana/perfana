export interface DeepLink {
  id: string;
  name: string;
  url: string;
  tags: string[];
}

export interface ResolvedDeepLink {
  id: string;
  name: string;
  url: string;
  isValid: boolean;
  unresolvedVariables?: string[];
  tags: string[];
}
