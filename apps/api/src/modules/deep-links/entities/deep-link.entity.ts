export class DeepLink {
  id!: string;
  systemUnderTestId!: string;
  testEnvironment!: string;
  workload!: string;
  name!: string;
  url!: string;
  templateDeepLinkId?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export class ResolvedDeepLink {
  id!: string;
  name!: string;
  url!: string;
  isValid!: boolean;
  unresolvedVariables?: string[];
  tags!: string[];
}