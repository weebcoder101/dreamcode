#!/usr/bin/env python3
"""DevOps analysis harness — analyzes CI/CD, infrastructure, and deployment patterns."""

import json
import re
import sys
from pathlib import Path

DEVOPS_PATTERNS = {
    "ci_cd": ["ci", "cd", "pipeline", "github actions", "jenkins", "gitlab ci", "build", "deploy"],
    "containerization": ["docker", "container", "image", "dockerfile", "compose", "kubernetes", "k8s"],
    "infrastructure": ["terraform", "pulumi", "cloudformation", "ansible", "iac", "infrastructure"],
    "monitoring": ["monitor", "grafana", "prometheus", "alert", "observability", "datadog", "metrics"],
    "logging": ["log", "elk", "loki", "fluentd", "logstash", "splunk"],
    "scaling": ["scale", "autoscale", "load balancer", "replica", "hpa", "cluster"],
    "security_ops": ["secret", "vault", "snyk", "trivy", "scan", "compliance", "policy"],
    "database_ops": ["migration", "backup", "restore", "replication", "failover", "disaster recovery"],
    "networking": ["dns", "vpc", "subnet", "firewall", "proxy", "reverse proxy", "nginx"],
    "cost": ["cost", "budget", "optimize", "reserved", "spot", "savings"],
}

DEVOPS_BEST_PRACTICES = {
    "ci_cd": "Use trunk-based development. Keep pipelines fast (<10 min). Cache dependencies. Pin versions.",
    "containerization": "Use multi-stage builds. Scan images for vulnerabilities. Use distroless base images.",
    "infrastructure": "Version all infrastructure. Use state locking. Review all IaC changes. Use modules.",
    "monitoring": "Monitor RED metrics (Rate, Errors, Duration). Set up SLO-based alerting. Use dashboards.",
    "logging": "Use structured logging (JSON). Centralize logs. Set log retention policies. Correlation IDs.",
    "scaling": "Use HPA with custom metrics. Implement graceful shutdown. Test with load testing tools.",
    "security_ops": "Shift left: scan in CI. Rotate secrets automatically. Use short-lived credentials.",
    "database_ops": "Test migrations in CI. Use blue-green deployments. Practice disaster recovery regularly.",
    "networking": "Use infrastructure as code for network config. Default-deny security groups.",
    "cost": "Tag all resources. Set budgets and alerts. Use spot instances for non-critical workloads.",
}


def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""


def analyze_prompt(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    findings = []
    practices = []

    for category, keywords in DEVOPS_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["devops review"]})

    for finding in findings:
        cat = finding["category"]
        if cat in DEVOPS_BEST_PRACTICES:
            practices.append({"category": cat, "practice": DEVOPS_BEST_PRACTICES[cat]})

    return {
        "analysis_type": "devops",
        "findings_count": len(findings),
        "findings": findings,
        "best_practices": practices,
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
