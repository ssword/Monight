import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_CATEGORIES,
  createBenchmarkReport,
  formatBenchmarkReport,
  measureBenchmark,
  validateBenchmarkReport,
} from '../lib/performance-benchmarks';

describe('createBenchmarkReport', () => {
  it('creates a report entry for each required issue 7 benchmark category', () => {
    const report = createBenchmarkReport({
      appVersion: '1.0.4',
      device: 'MacBook Pro M3',
      display: '3024x1964 @ 2x',
      testFiles: ['long-document.pdf: 400 pages, 120 MB'],
      reviewer: 'pending',
    });

    expect(report.results.map((result) => result.categoryId)).toEqual(
      BENCHMARK_CATEGORIES.map((category) => category.id),
    );
    expect(report.results).toHaveLength(6);
    expect(report.results.every((result) => result.before === null)).toBe(true);
    expect(report.results.every((result) => result.after === null)).toBe(true);
  });

  it('formats the report as one markdown baseline document with methodology context', () => {
    const report = createBenchmarkReport({
      appVersion: '1.0.4',
      device: 'MacBook Pro M3',
      display: '3024x1964 @ 2x',
      testFiles: ['long-document.pdf: 400 pages, 120 MB'],
      reviewer: 'pending',
    });

    const markdown = formatBenchmarkReport(report);

    expect(markdown).toContain('# Performance Benchmark Report');
    expect(markdown).toContain('- App version: 1.0.4');
    expect(markdown).toContain('- Device: MacBook Pro M3');
    expect(markdown).toContain('- Display: 3024x1964 @ 2x');
    expect(markdown).toContain('- Test files: long-document.pdf: 400 pages, 120 MB');
    expect(markdown).toContain('- Human review: pending');

    for (const category of BENCHMARK_CATEGORIES) {
      expect(markdown).toContain(category.label);
    }
  });

  it('reports missing measurements and pending human review before the baseline is complete', () => {
    const report = createBenchmarkReport({
      appVersion: '1.0.4',
      device: 'MacBook Pro M3',
      display: '3024x1964 @ 2x',
      testFiles: ['long-document.pdf: 400 pages, 120 MB'],
      reviewer: 'pending',
    });

    const issues = validateBenchmarkReport(report);

    expect(issues).toContain('large-pdf-open-time is missing a before measurement');
    expect(issues).toContain('large-pdf-open-time is missing an after measurement');
    expect(issues).toContain('human review is still pending');
  });

  it('measures an async benchmark workflow with a performance.now compatible clock', async () => {
    const timestamps = [100, 143.75];

    const measurement = await measureBenchmark(
      'large-pdf-open-time',
      async () => 'opened',
      () => timestamps.shift() ?? 0,
    );

    expect(measurement).toEqual({
      categoryId: 'large-pdf-open-time',
      duration: 43.75,
      result: 'opened',
    });
  });
});
