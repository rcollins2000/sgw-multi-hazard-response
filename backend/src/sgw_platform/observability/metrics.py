"""Prometheus metrics — counters, histograms, gauges."""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Histogram

REGISTRY = CollectorRegistry()

http_requests_total = Counter(
    "sgw_http_requests_total",
    "Total HTTP requests handled",
    labelnames=["method", "endpoint", "status"],
    registry=REGISTRY,
)

http_request_duration_seconds = Histogram(
    "sgw_http_request_duration_seconds",
    "HTTP request duration in seconds",
    labelnames=["method", "endpoint"],
    registry=REGISTRY,
)

model_calls_total = Counter(
    "sgw_model_calls_total",
    "Total model invocations",
    labelnames=["model_family", "model_version"],
    registry=REGISTRY,
)

openai_tokens_total = Counter(
    "sgw_openai_tokens_total",
    "OpenAI tokens consumed",
    labelnames=["direction", "model"],
    registry=REGISTRY,
)

audit_writes_total = Counter(
    "sgw_audit_writes_total",
    "Audit log entries written",
    labelnames=["action_type"],
    registry=REGISTRY,
)
