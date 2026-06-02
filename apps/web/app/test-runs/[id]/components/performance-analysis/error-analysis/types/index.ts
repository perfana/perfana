export interface ErrorSummary {
  totalErrors: number;
  uniqueResponseCodes: number;
  transactionsWithErrors: number;
  uniqueErrorUrls: number;
  totalRequests?: number;
  errorRate?: number;
}

export interface ErrorByCode {
  responseCode: string;
  errorCount: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
}

export interface ErrorByTransaction {
  transactionName: string;
  samplerName: string;
  url: string;
  errorCount: number;
  avgResponseTime: number;
  responseCode?: string;
  hasSessionVariables?: boolean;
}

export interface ErrorByTransactionGroup {
  transactionName: string;
  samplerName: string;
  totalErrorCount: number;
  avgResponseTime: number;
  responseCodes: string[];
  urlCount: number;
  children: ErrorByTransaction[];
}

export interface ErrorOverTime {
  timeBucket: string;
  errorsPerMinute: number;
}

export interface ErrorOverTimeByCode {
  timeBucket: string;
  [responseCode: string]: number | string; // Dynamic keys for each error code (e.g., "404": 5, "500": 2)
}

export interface ErrorDetail {
  time: string;
  transactionName: string;
  samplerName: string;
  responseCode: string;
  responseTime: number;
  url: string;
  responseMessage: string;
  responseData: string;
  requestHeaders: string;
  responseHeaders: string;
  sessionVariables?: Record<string, string> | null;
}

export interface ErrorAnalysisCardProps {
  testRunId: string;
}
