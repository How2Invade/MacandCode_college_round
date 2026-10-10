/**
 * Handsfree Benchmark Harness
 * 
 * Purpose: Provides a standard method to log and evaluate performance
 * metrics over recorded tasks in a realistic test harness.
 */

export interface BenchmarkMetrics {
  taskId: string;
  taskCompletionTimeMs: number;
  commandAccuracyPercent: number;
  selectionErrors: number;
  accidentalActivations: number;
  calibrationTimeMs?: number;
  recoveryTimeAfterLossMs?: number;
}

export class BenchmarkRunner {
  private metrics: BenchmarkMetrics[] = [];
  
  public recordResult(result: BenchmarkMetrics) {
    this.metrics.push(result);
  }
  
  public generateReport(): string {
    if (this.metrics.length === 0) return 'No benchmarks recorded.';
    
    let report = '# Handsfree Benchmark Report\n\n';
    
    const avgCompletion = this.metrics.reduce((acc, m) => acc + m.taskCompletionTimeMs, 0) / this.metrics.length;
    const avgAccuracy = this.metrics.reduce((acc, m) => acc + m.commandAccuracyPercent, 0) / this.metrics.length;
    const totalSelectionErrors = this.metrics.reduce((acc, m) => acc + m.selectionErrors, 0);
    const totalAccidental = this.metrics.reduce((acc, m) => acc + m.accidentalActivations, 0);
    
    report += `## Aggregated Metrics (${this.metrics.length} runs)\n`;
    report += `- Average Task Completion Time: ${avgCompletion.toFixed(2)} ms\n`;
    report += `- Average Command Accuracy: ${avgAccuracy.toFixed(2)}%\n`;
    report += `- Total Selection Errors: ${totalSelectionErrors}\n`;
    report += `- Total Accidental Activations: ${totalAccidental}\n\n`;
    
    report += `## Individual Runs\n`;
    this.metrics.forEach(m => {
      report += `- [${m.taskId}]: ${m.taskCompletionTimeMs}ms, Acc: ${m.commandAccuracyPercent}%, Sel. Errors: ${m.selectionErrors}\n`;
    });
    
    return report;
  }
}

// Example usage hook for CI or local testing
if (require.main === module) {
  const runner = new BenchmarkRunner();
  runner.recordResult({
    taskId: 'test-scroll-1',
    taskCompletionTimeMs: 1250,
    commandAccuracyPercent: 100,
    selectionErrors: 0,
    accidentalActivations: 0,
    calibrationTimeMs: 400
  });
  console.log(runner.generateReport());
}
