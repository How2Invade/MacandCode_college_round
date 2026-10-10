# Handsfree Benchmark Harness

This harness measures the practical effectiveness of Handsfree when navigating and operating webpages.

## Metrics Recorded

- **Task Completion Time (ms)**: Total time from command interpretation to validated execution.
- **Command Accuracy (%)**: Percentage of commands properly identified by the NLP/planner.
- **Selection Errors**: Count of times the cursor missed or triggered the wrong target.
- **Accidental Activations**: Count of mis-fires (e.g. dwell activating too soon or misinterpreting a head nod).
- **Calibration & Recovery**: Time taken to establish coordinate baselines or recover from losing tracking.

## Running Benchmarks

You can execute the harness against your recorded test datasets by running:
```bash
npx ts-node tests/benchmark/runBenchmarks.ts
```

*Note: Since actual hand/head-tracking integration relies on Member 1 & 2's components, you must supply pre-recorded positional datasets or use standard HTML interactive pages if testing manually.*

## Baseline Comparison
When adding new benchmark sets, compare the `Task Completion Time` against standard Mouse & Keyboard baselines (e.g. "Find news button and click" usually takes ~2.5s with a mouse).
