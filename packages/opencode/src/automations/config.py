"""Project-Q Configuration Layer — Environment-Variable Injection

All configurable values are read from environment variables with safe defaults.
No more hardcoded magic numbers.

Usage:
    from project_q.config import get_config
    config = get_config()
    confidence = config.risk.BACKTEST_CONFIDENCE
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(key: str, default, cast=None):
    """Read an environment variable with type casting."""
    val = os.environ.get(key)
    if val is None:
        return default
    if cast is not None:
        try:
            return cast(val)
        except (ValueError, TypeError):
            return default
    return val


# ---------------------------------------------------------------------------
# Risk Configuration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RiskConfig:
    BACKTEST_CONFIDENCE: float = 0.95
    BOOTSTRAP_SAMPLES: int = 1000
    BOOTSTRAP_SEED: int = 42
    CONFIDENCE_LEVELS: tuple[float, ...] = (0.95, 0.99)
    VAR_CONFIDENCE: float = 0.99
    ES_CONFIDENCE: float = 0.975

    @classmethod
    def from_env(cls) -> RiskConfig:
        levels = _env("RISK_CONFIDENCE_LEVELS", "0.95,0.99",
                      lambda s: tuple(float(x.strip()) for x in s.split(",")))
        return cls(
            BACKTEST_CONFIDENCE=_env("BACKTEST_CONFIDENCE", 0.95, float),
            BOOTSTRAP_SAMPLES=_env("BOOTSTRAP_SAMPLES", 1000, int),
            BOOTSTRAP_SEED=_env("BOOTSTRAP_SEED", 42, int),
            CONFIDENCE_LEVELS=levels,
            VAR_CONFIDENCE=_env("VAR_CONFIDENCE", 0.99, float),
            ES_CONFIDENCE=_env("ES_CONFIDENCE", 0.975, float),
        )


# ---------------------------------------------------------------------------
# Monte Carlo Configuration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MonteCarloConfig:
    N_SCENARIOS: int = 5000
    N_BOOTSTRAP_CI: int = 1000
    TIME_HORIZON: int = 1
    PORTFOLIO_VALUE: float = 1_000_000.0
    MAX_SAFE_SCENARIOS: int = 100_000
    USE_STREAMING: bool = False
    STREAMING_THRESHOLD: int = 50_000

    @classmethod
    def from_env(cls) -> MonteCarloConfig:
        return cls(
            N_SCENARIOS=_env("MC_N_SCENARIOS", 5000, int),
            N_BOOTSTRAP_CI=_env("MC_N_BOOTSTRAP_CI", 1000, int),
            TIME_HORIZON=_env("MC_TIME_HORIZON", 1, int),
            PORTFOLIO_VALUE=_env("MC_PORTFOLIO_VALUE", 1_000_000.0, float),
            MAX_SAFE_SCENARIOS=_env("MC_MAX_SAFE_SCENARIOS", 100_000, int),
            USE_STREAMING=_env("MC_USE_STREAMING", "false", lambda s: s.lower() == "true"),
            STREAMING_THRESHOLD=_env("MC_STREAMING_THRESHOLD", 50_000, int),
        )


# ---------------------------------------------------------------------------
# API Configuration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class APIConfig:
    HOST: str = "0.0.0.0"
    PORT: int = 5000
    DEBUG: bool = False
    CORS_ORIGIN: str = "http://localhost:5173"
    API_TOKEN: str = ""
    RATE_LIMIT_DEFAULT: str = "100 per hour"
    RATE_LIMIT_ENDPOINT: str = "5 per minute"
    MAX_REQUEST_SIZE: int = 10 * 1024 * 1024  # 10MB

    @classmethod
    def from_env(cls) -> APIConfig:
        return cls(
            HOST=_env("API_HOST", "0.0.0.0"),
            PORT=_env("API_PORT", 5000, int),
            DEBUG=_env("API_DEBUG", "false", lambda s: s.lower() == "true"),
            CORS_ORIGIN=_env("CORS_ORIGIN", "http://localhost:5173"),
            API_TOKEN=_env("API_TOKEN", ""),
            RATE_LIMIT_DEFAULT=_env("RATE_LIMIT_DEFAULT", "100 per hour"),
            RATE_LIMIT_ENDPOINT=_env("RATE_LIMIT_ENDPOINT", "5 per minute"),
            MAX_REQUEST_SIZE=_env("MAX_REQUEST_SIZE", 10 * 1024 * 1024, int),
        )


# ---------------------------------------------------------------------------
# Quantum Configuration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class QuantumConfig:
    QAE_N_STATE: int = 6
    QAE_N_EVAL: int = 4
    QAOA_MAXITER: int = 100
    SIMULATOR_BACKEND: str = "qasm_simulator"
    shots: int = 1024

    @classmethod
    def from_env(cls) -> QuantumConfig:
        return cls(
            QAE_N_STATE=_env("QAE_N_STATE", 6, int),
            QAE_N_EVAL=_env("QAE_N_EVAL", 4, int),
            QAOA_MAXITER=_env("QAOA_MAXITER", 100, int),
            SIMULATOR_BACKEND=_env("SIMULATOR_BACKEND", "qasm_simulator"),
            shots=_env("QUANTUM_SHOTS", 1024, int),
        )


# ---------------------------------------------------------------------------
# Volatility Configuration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class VolatilityConfig:
    DCC_OMEGA: float = 0.00005
    DCC_ALPHA: float = 0.05
    DCC_BETA: float = 0.93
    GARCH_P: int = 1
    GARCH_Q: int = 1
    REGIME_N_REGIMES: int = 3
    REGIME_LOOKBACK: int = 252

    @classmethod
    def from_env(cls) -> VolatilityConfig:
        return cls(
            DCC_OMEGA=_env("DCC_OMEGA", 0.00005, float),
            DCC_ALPHA=_env("DCC_ALPHA", 0.05, float),
            DCC_BETA=_env("DCC_BETA", 0.93, float),
            GARCH_P=_env("GARCH_P", 1, int),
            GARCH_Q=_env("GARCH_Q", 1, int),
            REGIME_N_REGIMES=_env("REGIME_N_REGIMES", 3, int),
            REGIME_LOOKBACK=_env("REGIME_LOOKBACK", 252, int),
        )


# ---------------------------------------------------------------------------
# Root Config
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ProjectQConfig:
    PROJECT_ROOT: Path = field(default_factory=lambda: Path(__file__).resolve().parent.parent.parent)
    ENV: str = "production"
    LOG_LEVEL: str = "INFO"
    risk: RiskConfig = field(default_factory=RiskConfig.from_env)
    monte_carlo: MonteCarloConfig = field(default_factory=MonteCarloConfig.from_env)
    api: APIConfig = field(default_factory=APIConfig.from_env)
    quantum: QuantumConfig = field(default_factory=QuantumConfig.from_env)
    volatility: VolatilityConfig = field(default_factory=VolatilityConfig.from_env)

    @classmethod
    def from_env(cls) -> ProjectQConfig:
        return cls(
            ENV=_env("PROJECTQ_ENV", "production"),
            LOG_LEVEL=_env("LOG_LEVEL", "INFO"),
        )


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_config: ProjectQConfig | None = None


def get_config() -> ProjectQConfig:
    """Get the global configuration (lazy-loaded singleton)."""
    global _config
    if _config is None:
        _config = ProjectQConfig.from_env()
    return _config


def reset_config() -> None:
    """Reset the configuration (for testing)."""
    global _config
    _config = None
