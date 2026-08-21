#!/usr/bin/env python3
"""Data analysis harness — analyzes prompts for data processing, analysis, and pipeline concerns."""

import json
import re
import sys
from pathlib import Path

DATA_PATTERNS = {
    "data_loading": ["load", "import", "read", "parse", "ingest", "extract", "fetch"],
    "data_cleaning": ["clean", "nan", "null", "missing", "duplicate", "outlier", "normalize"],
    "transformation": ["transform", "map", "convert", "aggregate", "pivot", "melt", "join"],
    "analysis": ["analyze", "statistics", "correlation", "regression", "distribution", "cluster"],
    "visualization": ["plot", "chart", "graph", "dashboard", "visualize", "matplotlib", "ggplot"],
    "ml": ["machine learning", "train", "model", "feature", "predict", "classify", "regression"],
    "big_data": ["spark", "hadoop", "distributed", "parquet", "partition", "batch"],
    "database_data": ["sql", "query", "join", "index", "schema", "migration", "etl"],
    "time_series": ["time series", "timestamp", "forecast", "trend", "seasonal", "rolling"],
    "pipeline_data": ["pipeline", "etl", "dag", "airflow", "prefect", "dataflow", "stream"],
}

DATA_RECOMMENDATIONS = {
    "data_loading": "Validate schema on load. Handle missing files gracefully. Use lazy loading for large datasets.",
    "data_cleaning": "Document cleaning decisions. Keep raw data immutable. Log all transformations.",
    "transformation": "Use vectorized operations (pandas/NumPy). Test transformation logic. Cache intermediate results.",
    "analysis": "Start with exploratory analysis. Document assumptions. Use hypothesis testing for conclusions.",
    "visualization": "Choose chart type based on data and audience. Label axes clearly. Use colorblind-friendly palettes.",
    "ml": "Split data before any preprocessing. Use cross-validation. Track experiments. Version models.",
    "big_data": "Use columnar formats (Parquet). Partition by date. Use appropriate file sizes (~128MB).",
    "database_data": "Profile queries. Use EXPLAIN ANALYZE. Add indexes based on query patterns.",
    "time_series": "Handle timezones consistently. Use resampling for irregular intervals. Validate stationarity.",
    "pipeline_data": "Make pipelines idempotent. Add data quality checks. Monitor pipeline health.",
}


def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""


def analyze_prompt(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    findings = []
    recommendations = []

    for category, keywords in DATA_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["data analysis"]})

    for finding in findings:
        cat = finding["category"]
        if cat in DATA_RECOMMENDATIONS:
            recommendations.append({"category": cat, "recommendation": DATA_RECOMMENDATIONS[cat]})

    return {
        "analysis_type": "data",
        "findings_count": len(findings),
        "findings": findings,
        "recommendations": recommendations,
        "prompt_length": len(prompt),
    }


def main():
    prompt_file = None
    for i, arg in enumerate(sys.argv):
        if arg == "--prompt-file" and i + 1 < len(sys.argv):
            prompt_file = sys.argv[i + 1]
            break

    prompt = read_prompt(prompt_file) if prompt_file else ""
    if not prompt:
        print(json.dumps({"status": "skipped", "reason": "No prompt provided"}))
        sys.exit(0)

    result = analyze_prompt(prompt)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
