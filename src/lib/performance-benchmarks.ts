export const BENCHMARK_CATEGORIES = [
  {
    id: 'large-pdf-open-time',
    label: 'Large-PDF open time',
    sourceIssues: ['#2'],
  },
  {
    id: 'zoom-rotate-latency',
    label: 'Zoom and rotate latency in continuous mode on a many-page document',
    sourceIssues: ['#3'],
  },
  {
    id: 'tab-switch-time',
    label: 'Tab-switch time',
    sourceIssues: ['#3'],
  },
  {
    id: 'scroll-frame-timing',
    label: 'Scroll frame timing on a long document',
    sourceIssues: ['#4'],
  },
  {
    id: 'cold-start-to-splash',
    label: 'Cold-start-to-splash time and initial main-thread bundle size',
    sourceIssues: ['#5'],
  },
  {
    id: 'peak-canvas-memory',
    label: 'Peak canvas memory at maximum zoom on a high-resolution display',
    sourceIssues: ['#6'],
  },
] as const;

export type BenchmarkCategoryId = (typeof BENCHMARK_CATEGORIES)[number]['id'];

export interface BenchmarkReportMetadata {
  appVersion: string;
  device: string;
  display: string;
  testFiles: string[];
  reviewer: string;
}

export interface BenchmarkResult {
  categoryId: BenchmarkCategoryId;
  before: number | null;
  after: number | null;
  unit: string;
  notes: string;
}

export interface BenchmarkReport {
  metadata: BenchmarkReportMetadata;
  results: BenchmarkResult[];
}

export interface BenchmarkMeasurement<T> {
  categoryId: BenchmarkCategoryId;
  duration: number;
  result: T;
}

export function createBenchmarkReport(metadata: BenchmarkReportMetadata): BenchmarkReport {
  return {
    metadata,
    results: BENCHMARK_CATEGORIES.map((category) => ({
      categoryId: category.id,
      before: null,
      after: null,
      unit: 'ms',
      notes: '',
    })),
  };
}

export async function measureBenchmark<T>(
  categoryId: BenchmarkCategoryId,
  operation: () => Promise<T>,
  now: () => number = () => performance.now(),
): Promise<BenchmarkMeasurement<T>> {
  const start = now();
  const result = await operation();
  const end = now();

  return {
    categoryId,
    duration: end - start,
    result,
  };
}

function formatNullableMetric(value: number | null, unit: string): string {
  return value === null ? 'pending' : `${value} ${unit}`;
}

export function formatBenchmarkReport(report: BenchmarkReport): string {
  const testFiles =
    report.metadata.testFiles.length > 0 ? report.metadata.testFiles.join('; ') : 'pending';
  const categoryLabels = new Map(
    BENCHMARK_CATEGORIES.map((category) => [category.id, category.label]),
  );
  const rows = report.results.map((result) => {
    const label = categoryLabels.get(result.categoryId) ?? result.categoryId;
    return `| ${label} | ${formatNullableMetric(result.before, result.unit)} | ${formatNullableMetric(result.after, result.unit)} | ${result.notes || 'pending'} |`;
  });

  return [
    '# Performance Benchmark Report',
    '',
    '## Methodology',
    '',
    `- App version: ${report.metadata.appVersion}`,
    `- Device: ${report.metadata.device}`,
    `- Display: ${report.metadata.display}`,
    `- Test files: ${testFiles}`,
    `- Human review: ${report.metadata.reviewer}`,
    '',
    '## Results',
    '',
    '| Benchmark | Before | After | Notes |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

export function validateBenchmarkReport(report: BenchmarkReport): string[] {
  const issues: string[] = [];

  if (!report.metadata.appVersion.trim()) {
    issues.push('app version is missing');
  }
  if (!report.metadata.device.trim()) {
    issues.push('device is missing');
  }
  if (!report.metadata.display.trim()) {
    issues.push('display is missing');
  }
  if (report.metadata.testFiles.length === 0) {
    issues.push('test files are missing');
  }
  if (!report.metadata.reviewer.trim() || report.metadata.reviewer === 'pending') {
    issues.push('human review is still pending');
  }

  const resultsByCategory = new Map(report.results.map((result) => [result.categoryId, result]));

  for (const category of BENCHMARK_CATEGORIES) {
    const result = resultsByCategory.get(category.id);
    if (!result) {
      issues.push(`${category.id} is missing`);
      continue;
    }
    if (result.before === null) {
      issues.push(`${category.id} is missing a before measurement`);
    }
    if (result.after === null) {
      issues.push(`${category.id} is missing an after measurement`);
    }
  }

  return issues;
}
