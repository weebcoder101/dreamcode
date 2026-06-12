#!/usr/bin/env python3
"""
NEURO Model Registry — Complete catalog of all available models.

Auto-generated from NEURO API /v1/models endpoint.
Last synced: 2026-06-09
Total models: 138

Features:
- Model chaining (Model A → Model B → Model C)
- Parallel execution (Model A + Model B simultaneously)
- Task decomposition (split complex tasks across models)
"""

from dataclasses import dataclass, field
from enum import Enum


class ModelCategory(Enum):
    """Model capability categories."""
    CODE = "code"
    SECURITY = "security"
    FINANCE = "finance"
    LEGAL = "legal"
    HR = "hr"
    MARKETING = "marketing"
    SALES = "sales"
    SUPPORT = "support"
    DATA = "data"
    DOCUMENT = "document"
    OPERATIONS = "operations"
    GENERAL = "general"
    SPECIALIZED = "specialized"
    PRODUCT = "product"
    COMMUNICATION = "communication"


class ExecutionMode(Enum):
    """How a model executes in a chain."""
    SEQUENTIAL = "sequential"  # Must run after previous model
    PARALLEL = "parallel"     # Can run alongside other parallel models
    FALLBACK = "fallback"     # Only if primary fails
    OPTIONAL = "optional"     # Nice to have, skip if time-constrained


@dataclass
class ModelInfo:
    """Model metadata."""
    id: str
    name: str
    category: ModelCategory
    description: str
    best_for: list[str]
    skill_affinity: list[str]  # Skills this model works well with
    tier: int  # 1=fast/cheap, 2=balanced, 3=powerful/expensive
    # Chain capabilities
    can_chain_with: list[str] = field(default_factory=list)  # Models this can chain with
    execution_mode: ExecutionMode = ExecutionMode.SEQUENTIAL
    decomposes_to: list[str] = field(default_factory=list)  # Sub-models for decomposition
    input_categories: list[ModelCategory] = field(default_factory=list)  # What it accepts
    output_categories: list[ModelCategory] = field(default_factory=list)  # What it produces


# ---------------------------------------------------------------------------
# MODEL REGISTRY — 120+ models organized by capability
# ---------------------------------------------------------------------------

MODELS: dict[str, ModelInfo] = {

    # ========================================================================
    # CLAWPACK FAMILY — General-purpose reasoning
    # ========================================================================
    "neurometric/clawpack": ModelInfo(
        id="neurometric/clawpack",
        name="ClawPack",
        category=ModelCategory.GENERAL,
        description="Base general-purpose reasoning model. Good all-rounder for code review, analysis, and planning.",
        best_for=["code review", "analysis", "planning", "general reasoning"],
        skill_affinity=["neuro", "code-hardener", "planning", "architecture"],
        tier=2,
        can_chain_with=["neurometric/code-writer", "neurometric/auth-guard", "neurometric/chart-mapper"],
        execution_mode=ExecutionMode.SEQUENTIAL,
        input_categories=[ModelCategory.GENERAL, ModelCategory.CODE],
        output_categories=[ModelCategory.GENERAL, ModelCategory.CODE],
    ),
    "neurometric/clawpack-pro": ModelInfo(
        id="neurometric/clawpack-pro",
        name="ClawPack Pro",
        category=ModelCategory.GENERAL,
        description="Enhanced reasoning with deeper analysis. Best for complex architectural decisions.",
        best_for=["complex architecture", "deep analysis", "multi-file refactoring"],
        skill_affinity=["neuro", "exhaustive-crosscheck", "architecture", "breakthrough-overdrive-innovation"],
        tier=3,
        can_chain_with=["neurometric/code-refactorer", "neurometric/design-doc", "neurometric/adr-writer"],
        execution_mode=ExecutionMode.SEQUENTIAL,
        input_categories=[ModelCategory.GENERAL, ModelCategory.CODE],
        output_categories=[ModelCategory.GENERAL, ModelCategory.DOCUMENT],
    ),
    "neurometric/clawpack-coding": ModelInfo(
        id="neurometric/clawpack-coding",
        name="ClawPack Coding",
        category=ModelCategory.CODE,
        description="Specialized for code generation, refactoring, and debugging.",
        best_for=["code generation", "refactoring", "debugging", "test writing"],
        skill_affinity=["python", "frontend", "react", "api", "refactoring", "testing", "debugging"],
        tier=2,
        can_chain_with=["neurometric/style-fixer", "neurometric/regex-gen", "neurometric/bash-medic"],
        execution_mode=ExecutionMode.SEQUENTIAL,
        decomposes_to=["neurometric/code-writer", "neurometric/code-refactorer"],
        input_categories=[ModelCategory.CODE],
        output_categories=[ModelCategory.CODE],
    ),
    "neurometric/clawpack-pro": ModelInfo(
        id="neurometric/clawpack-pro",
        name="ClawPack Pro",
        category=ModelCategory.GENERAL,
        description="Enhanced reasoning with deeper analysis. Best for complex architectural decisions.",
        best_for=["complex architecture", "deep analysis", "multi-file refactoring"],
        skill_affinity=["neuro", "exhaustive-crosscheck", "architecture", "breakthrough-overdrive-innovation"],
        tier=3,
    ),
    "neurometric/clawpack-general": ModelInfo(
        id="neurometric/clawpack-general",
        name="ClawPack General",
        category=ModelCategory.GENERAL,
        description="Optimized for general tasks. Fast and cost-effective.",
        best_for=["quick analysis", "simple reviews", "documentation"],
        skill_affinity=["documentation", "communication", "onboarding"],
        tier=1,
    ),
    "neurometric/clawpack-coding": ModelInfo(
        id="neurometric/clawpack-coding",
        name="ClawPack Coding",
        category=ModelCategory.CODE,
        description="Specialized for code generation, refactoring, and debugging.",
        best_for=["code generation", "refactoring", "debugging", "test writing"],
        skill_affinity=["python", "frontend", "react", "api", "refactoring", "testing", "debugging"],
        tier=2,
    ),
    "neurometric/clawpack-legal": ModelInfo(
        id="neurometric/clawpack-legal",
        name="ClawPack Legal",
        category=ModelCategory.LEGAL,
        description="Legal document analysis and contract review.",
        best_for=["contract review", "legal compliance", "regulation analysis"],
        skill_affinity=["security", "quality"],
        tier=2,
    ),
    "neurometric/clawpack-finance": ModelInfo(
        id="neurometric/clawpack-finance",
        name="ClawPack Finance",
        category=ModelCategory.FINANCE,
        description="Financial analysis, risk assessment, and quantitative modeling.",
        best_for=["financial modeling", "risk analysis", "quantitative research"],
        skill_affinity=["quantum", "data", "performance"],
        tier=2,
    ),
    "neurometric/clawpack-sales": ModelInfo(
        id="neurometric/clawpack-sales",
        name="ClawPack Sales",
        category=ModelCategory.SALES,
        description="Sales enablement, battlecards, and competitive analysis.",
        best_for=["battlecards", "competitive analysis", "sales scripts"],
        skill_affinity=["product", "communication"],
        tier=1,
    ),
    "neurometric/clawpack-support": ModelInfo(
        id="neurometric/clawpack-support",
        name="ClawPack Support",
        category=ModelCategory.SUPPORT,
        description="Customer support ticket handling and response generation.",
        best_for=["ticket resolution", "support responses", "escalation routing"],
        skill_affinity=["communication", "documentation"],
        tier=1,
    ),
    "neurometric/clawpack-marketing": ModelInfo(
        id="neurometric/clawpack-marketing",
        name="ClawPack Marketing",
        category=ModelCategory.MARKETING,
        description="Marketing content, SEO, and campaign optimization.",
        best_for=["content creation", "SEO optimization", "campaign analysis"],
        skill_affinity=["documentation", "communication", "product"],
        tier=1,
    ),

    # ========================================================================
    # CODE MODELS — Specialized for development
    # ========================================================================
    "neurometric/code-writer": ModelInfo(
        id="neurometric/code-writer",
        name="Code Writer",
        category=ModelCategory.CODE,
        description="Generates code from specifications. Handles multiple languages.",
        best_for=["code generation", "function implementation", "boilerplate"],
        skill_affinity=["python", "frontend", "react", "api", "refactoring"],
        tier=2,
    ),
    "neurometric/code-refactorer": ModelInfo(
        id="neurometric/code-refactorer",
        name="Code Refactorer",
        category=ModelCategory.CODE,
        description="Safe code restructuring with behavior preservation.",
        best_for=["refactoring", "code cleanup", "pattern application"],
        skill_affinity=["refactoring", "code-hardener", "quality"],
        tier=2,
    ),
    "neurometric/regex-gen": ModelInfo(
        id="neurometric/regex-gen",
        name="Regex Generator",
        category=ModelCategory.CODE,
        description="Generates and explains regular expressions.",
        best_for=["regex creation", "pattern matching", "text extraction"],
        skill_affinity=["python", "data"],
        tier=1,
    ),
    "neurometric/bash-medic": ModelInfo(
        id="neurometric/bash-medic",
        name="Bash Medic",
        category=ModelCategory.CODE,
        description="Shell script debugging and optimization.",
        best_for=["shell scripting", "bash debugging", "command optimization"],
        skill_affinity=["devops", "git"],
        tier=1,
    ),
    "neurometric/cobol-to-python": ModelInfo(
        id="neurometric/cobol-to-python",
        name="COBOL to Python",
        category=ModelCategory.CODE,
        description="Legacy COBOL to Python migration.",
        best_for=["legacy migration", "code translation", "modernization"],
        skill_affinity=["refactoring", "python"],
        tier=2,
    ),
    "neurometric/sdk-maker": ModelInfo(
        id="neurometric/sdk-maker",
        name="SDK Maker",
        category=ModelCategory.CODE,
        description="Generates SDK wrappers and API clients.",
        best_for=["SDK generation", "API client creation", "wrapper code"],
        skill_affinity=["api", "python", "documentation"],
        tier=2,
    ),
    "neurometric/style-fixer": ModelInfo(
        id="neurometric/style-fixer",
        name="Style Fixer",
        category=ModelCategory.CODE,
        description="Code style enforcement and formatting.",
        best_for=["code formatting", "style consistency", "lint fixes"],
        skill_affinity=["lint-fixer", "quality"],
        tier=1,
    ),

    # ========================================================================
    # SECURITY MODELS
    # ========================================================================
    "neurometric/auth-guard": ModelInfo(
        id="neurometric/auth-guard",
        name="Auth Guard",
        category=ModelCategory.SECURITY,
        description="Authentication and authorization security review.",
        best_for=["auth review", "security audit", "vulnerability detection"],
        skill_affinity=["security", "code-hardener"],
        tier=2,
        can_chain_with=["neurometric/reg-compliance", "neurometric/policy-check", "neurometric/conflict-check"],
        execution_mode=ExecutionMode.SEQUENTIAL,
        input_categories=[ModelCategory.CODE, ModelCategory.SECURITY],
        output_categories=[ModelCategory.SECURITY, ModelCategory.DOCUMENT],
    ),
    "neurometric/code-writer": ModelInfo(
        id="neurometric/code-writer",
        name="Code Writer",
        category=ModelCategory.CODE,
        description="Generates code from specifications. Handles multiple languages.",
        best_for=["code generation", "function implementation", "boilerplate"],
        skill_affinity=["python", "frontend", "react", "api", "refactoring"],
        tier=2,
        can_chain_with=["neurometric/style-fixer", "neurometric/regex-gen"],
        execution_mode=ExecutionMode.SEQUENTIAL,
        input_categories=[ModelCategory.DOCUMENT, ModelCategory.GENERAL],
        output_categories=[ModelCategory.CODE],
    ),
    "neurometric/code-refactorer": ModelInfo(
        id="neurometric/code-refactorer",
        name="Code Refactorer",
        category=ModelCategory.CODE,
        description="Safe code restructuring with behavior preservation.",
        best_for=["refactoring", "code cleanup", "pattern application"],
        skill_affinity=["refactoring", "code-hardener", "quality"],
        tier=2,
        can_chain_with=["neurometric/style-fixer", "neurometric/code-writer"],
        execution_mode=ExecutionMode.SEQUENTIAL,
        input_categories=[ModelCategory.CODE],
        output_categories=[ModelCategory.CODE],
    ),
    "neurometric/policy-check": ModelInfo(
        id="neurometric/policy-check",
        name="Policy Check",
        category=ModelCategory.SECURITY,
        description="Policy compliance verification.",
        best_for=["policy review", "compliance check", "regulation adherence"],
        skill_affinity=["security", "quality"],
        tier=1,
    ),
    "neurometric/reg-compliance": ModelInfo(
        id="neurometric/reg-compliance",
        name="Regulatory Compliance",
        category=ModelCategory.SECURITY,
        description="Regulatory compliance analysis (GDPR, HIPAA, etc.).",
        best_for=["regulation compliance", "privacy review", "data governance"],
        skill_affinity=["security", "quality"],
        tier=2,
    ),
    "neurometric/conflict-check": ModelInfo(
        id="neurometric/conflict-check",
        name="Conflict Check",
        category=ModelCategory.SECURITY,
        description="Conflict of interest detection.",
        best_for=["conflict detection", "ethics review", "compliance"],
        skill_affinity=["security"],
        tier=1,
    ),

    # ========================================================================
    # FINANCE MODELS
    # ========================================================================
    "neurometric/stock-val": ModelInfo(
        id="neurometric/stock-val",
        name="Stock Valuator",
        category=ModelCategory.FINANCE,
        description="Stock valuation and financial analysis.",
        best_for=["stock analysis", "valuation", "financial modeling"],
        skill_affinity=["quantum", "data"],
        tier=2,
    ),
    "neurometric/debt-collector": ModelInfo(
        id="neurometric/debt-collector",
        name="Debt Collector",
        category=ModelCategory.FINANCE,
        description="Debt collection strategy and optimization.",
        best_for=["debt recovery", "collection strategy", "payment optimization"],
        skill_affinity=["data", "product"],
        tier=1,
    ),
    "neurometric/cash-flow-ref": ModelInfo(
        id="neurometric/cash-flow-ref",
        name="Cash Flow Reference",
        category=ModelCategory.FINANCE,
        description="Cash flow analysis and forecasting.",
        best_for=["cash flow analysis", "forecasting", "liquidity planning"],
        skill_affinity=["data", "quantum"],
        tier=2,
    ),
    "neurometric/ratio-analyzer": ModelInfo(
        id="neurometric/ratio-analyzer",
        name="Ratio Analyzer",
        category=ModelCategory.FINANCE,
        description="Financial ratio analysis and benchmarking.",
        best_for=["ratio analysis", "benchmarking", "financial health"],
        skill_affinity=["data", "quantum"],
        tier=2,
    ),
    "neurometric/forecast-narrator": ModelInfo(
        id="neurometric/forecast-narrator",
        name="Forecast Narrator",
        category=ModelCategory.FINANCE,
        description="Generates narrative summaries from financial forecasts.",
        best_for=["forecast summaries", "financial reporting", "investor updates"],
        skill_affinity=["documentation", "communication"],
        tier=1,
    ),
    "neurometric/risk-evaluator": ModelInfo(
        id="neurometric/risk-evaluator",
        name="Risk Evaluator",
        category=ModelCategory.FINANCE,
        description="Risk assessment and mitigation strategy.",
        best_for=["risk analysis", "mitigation planning", "risk scoring"],
        skill_affinity=["security", "quantum", "performance"],
        tier=2,
    ),
    "neurometric/expense-code": ModelInfo(
        id="neurometric/expense-code",
        name="Expense Coder",
        category=ModelCategory.FINANCE,
        description="Expense categorization and coding.",
        best_for=["expense tracking", "categorization", "accounting"],
        skill_affinity=["data"],
        tier=1,
    ),

    # ========================================================================
    # LEGAL MODELS
    # ========================================================================
    "neurometric/legal-template": ModelInfo(
        id="neurometric/legal-template",
        name="Legal Template",
        category=ModelCategory.LEGAL,
        description="Legal document template generation.",
        best_for=["contract templates", "legal documents", "agreements"],
        skill_affinity=["documentation"],
        tier=1,
    ),
    "neurometric/legalese-to-plain": ModelInfo(
        id="neurometric/legalese-to-plain",
        name="Legalese to Plain English",
        category=ModelCategory.LEGAL,
        description="Converts legal language to plain English.",
        best_for=["legal translation", "simplification", "accessibility"],
        skill_affinity=["communication", "documentation"],
        tier=1,
    ),
    "neurometric/depo-summary": ModelInfo(
        id="neurometric/depo-summary",
        name="Deposition Summary",
        category=ModelCategory.LEGAL,
        description="Summarizes depositions and legal proceedings.",
        best_for=["deposition analysis", "legal summary", "case preparation"],
        skill_affinity=["documentation", "research"],
        tier=2,
    ),
    "neurometric/prior-art-ai": ModelInfo(
        id="neurometric/prior-art-ai",
        name="Prior Art AI",
        category=ModelCategory.LEGAL,
        description="Patent prior art search and analysis.",
        best_for=["patent research", "prior art search", "IP analysis"],
        skill_affinity=["research", "documentation"],
        tier=2,
    ),
    "neurometric/contract-risk-analyzer": ModelInfo(
        id="neurometric/contract-risk-analyzer",
        name="Contract Risk Analyzer",
        category=ModelCategory.LEGAL,
        description="Identifies risks in contracts and agreements.",
        best_for=["contract review", "risk identification", "legal analysis"],
        skill_affinity=["security", "quality"],
        tier=2,
    ),
    "neurometric/clause-extractor": ModelInfo(
        id="neurometric/clause-extractor",
        name="Clause Extractor",
        category=ModelCategory.LEGAL,
        description="Extracts and categorizes contract clauses.",
        best_for=["clause extraction", "contract analysis", "legal review"],
        skill_affinity=["research", "documentation"],
        tier=1,
    ),
    "neurometric/redline-diff": ModelInfo(
        id="neurometric/redline-diff",
        name="Redline Diff",
        category=ModelCategory.LEGAL,
        description="Document comparison and redlining.",
        best_for=["document comparison", "change tracking", "version review"],
        skill_affinity=["quality", "documentation"],
        tier=1,
    ),

    # ========================================================================
    # HR/PEOPLE MODELS
    # ========================================================================
    "neurometric/jd-writer": ModelInfo(
        id="neurometric/jd-writer",
        name="Job Description Writer",
        category=ModelCategory.HR,
        description="Generates job descriptions and requirements.",
        best_for=["job descriptions", "hiring docs", "role definitions"],
        skill_affinity=["documentation", "product"],
        tier=1,
    ),
    "neurometric/interview-analyst": ModelInfo(
        id="neurometric/interview-analyst",
        name="Interview Analyst",
        category=ModelCategory.HR,
        description="Analyzes interview feedback and scores candidates.",
        best_for=["interview analysis", "candidate scoring", "hiring decisions"],
        skill_affinity=["data", "product"],
        tier=2,
    ),
    "neurometric/offer-architect": ModelInfo(
        id="neurometric/offer-architect",
        name="Offer Architect",
        category=ModelCategory.HR,
        description="Designs competitive job offers.",
        best_for=["offer creation", "compensation planning", "negotiation"],
        skill_affinity=["product", "communication"],
        tier=1,
    ),
    "neurometric/newhire-nav": ModelInfo(
        id="neurometric/newhire-nav",
        name="New Hire Navigator",
        category=ModelCategory.HR,
        description="Onboarding guidance for new employees.",
        best_for=["onboarding", "orientation", "training planning"],
        skill_affinity=["onboarding", "documentation"],
        tier=1,
    ),
    "neurometric/bias-check": ModelInfo(
        id="neurometric/bias-check",
        name="Bias Checker",
        category=ModelCategory.HR,
        description="Detects bias in job descriptions and communications.",
        best_for=["bias detection", "inclusive language", "compliance"],
        skill_affinity=["quality", "security"],
        tier=1,
    ),
    "neurometric/review-recruit": ModelInfo(
        id="neurometric/review-recruit",
        name="Review Recruiter",
        category=ModelCategory.HR,
        description="Reviews and optimizes recruitment processes.",
        best_for=["recruitment optimization", "process review", "hiring efficiency"],
        skill_affinity=["product", "data"],
        tier=1,
    ),
    "neurometric/retention-insight": ModelInfo(
        id="neurometric/retention-insight",
        name="Retention Insight",
        category=ModelCategory.HR,
        description="Employee retention analysis and predictions.",
        best_for=["retention analysis", "turnover prediction", "engagement"],
        skill_affinity=["data", "product"],
        tier=2,
    ),

    # ========================================================================
    # MARKETING MODELS
    # ========================================================================
    "neurometric/promo-writer": ModelInfo(
        id="neurometric/promo-writer",
        name="Promo Writer",
        category=ModelCategory.MARKETING,
        description="Promotional content and ad copy generation.",
        best_for=["ad copy", "promotions", "marketing content"],
        skill_affinity=["communication", "product"],
        tier=1,
    ),
    "neurometric/keyword-king": ModelInfo(
        id="neurometric/keyword-king",
        name="Keyword King",
        category=ModelCategory.MARKETING,
        description="SEO keyword research and optimization.",
        best_for=["keyword research", "SEO", "content optimization"],
        skill_affinity=["documentation", "product"],
        tier=1,
    ),
    "neurometric/ppc-pilot": ModelInfo(
        id="neurometric/ppc-pilot",
        name="PPC Pilot",
        category=ModelCategory.MARKETING,
        description="Pay-per-click campaign management.",
        best_for=["PPC campaigns", "ad optimization", "budget allocation"],
        skill_affinity=["data", "product"],
        tier=2,
    ),
    "neurometric/tone-checker": ModelInfo(
        id="neurometric/tone-checker",
        name="Tone Checker",
        category=ModelCategory.MARKETING,
        description="Brand tone consistency checker.",
        best_for=["tone analysis", "brand consistency", "content review"],
        skill_affinity=["communication", "quality"],
        tier=1,
    ),
    "neurometric/landing-optimize": ModelInfo(
        id="neurometric/landing-optimize",
        name="Landing Page Optimizer",
        category=ModelCategory.MARKETING,
        description="Landing page conversion optimization.",
        best_for=["landing pages", "conversion optimization", "A/B testing"],
        skill_affinity=["frontend", "product", "data"],
        tier=2,
    ),
    "neurometric/trend-hitch": ModelInfo(
        id="neurometric/trend-hitch",
        name="Trend Hitcher",
        category=ModelCategory.MARKETING,
        description="Trend analysis and content hooks.",
        best_for=["trend analysis", "content hooks", "viral marketing"],
        skill_affinity=["data", "product"],
        tier=1,
    ),
    "neurometric/media-reach": ModelInfo(
        id="neurometric/media-reach",
        name="Media Reach",
        category=ModelCategory.MARKETING,
        description="Media outreach and PR strategy.",
        best_for=["PR strategy", "media outreach", "press releases"],
        skill_affinity=["communication", "product"],
        tier=1,
    ),
    "neurometric/success-story": ModelInfo(
        id="neurometric/success-story",
        name="Success Story",
        category=ModelCategory.MARKETING,
        description="Customer success story generation.",
        best_for=["case studies", "success stories", "testimonial packaging"],
        skill_affinity=["documentation", "communication"],
        tier=1,
    ),

    # ========================================================================
    # SALES MODELS
    # ========================================================================
    "neurometric/battlecard-gen": ModelInfo(
        id="neurometric/battlecard-gen",
        name="Battlecard Generator",
        category=ModelCategory.SALES,
        description="Competitive battlecard creation.",
        best_for=["competitive analysis", "sales enablement", "battlecards"],
        skill_affinity=["product", "research"],
        tier=1,
    ),
    "neurometric/closer-ai": ModelInfo(
        id="neurometric/closer-ai",
        name="Closer AI",
        category=ModelCategory.SALES,
        description="Sales closing strategies and scripts.",
        best_for=["sales scripts", "closing strategies", "objection handling"],
        skill_affinity=["communication", "product"],
        tier=1,
    ),
    "neurometric/bdr-bot": ModelInfo(
        id="neurometric/bdr-bot",
        name="BDR Bot",
        category=ModelCategory.SALES,
        description="Business development representative automation.",
        best_for=["prospecting", "outreach", "lead qualification"],
        skill_affinity=["communication", "product"],
        tier=1,
    ),
    "neurometric/hyper-pers": ModelInfo(
        id="neurometric/hyper-pers",
        name="Hyper Personalizer",
        category=ModelCategory.SALES,
        description="Hyper-personalized outreach generation.",
        best_for=["personalized emails", "custom pitches", "account-based marketing"],
        skill_affinity=["communication", "product"],
        tier=2,
    ),
    "neurometric/churn-guard": ModelInfo(
        id="neurometric/churn-guard",
        name="Churn Guard",
        category=ModelCategory.SALES,
        description="Customer churn prediction and prevention.",
        best_for=["churn prediction", "retention strategy", "customer health"],
        skill_affinity=["data", "product"],
        tier=2,
    ),
    "neurometric/network-grow": ModelInfo(
        id="neurometric/network-grow",
        name="Network Grower",
        category=ModelCategory.SALES,
        description="Professional network expansion strategy.",
        best_for=["networking", "relationship building", "referral strategy"],
        skill_affinity=["communication", "product"],
        tier=1,
    ),

    # ========================================================================
    # SUPPORT MODELS
    # ========================================================================
    "neurometric/support-poly": ModelInfo(
        id="neurometric/support-poly",
        name="Support Polygon",
        category=ModelCategory.SUPPORT,
        description="Multi-channel support ticket routing.",
        best_for=["ticket routing", "support prioritization", "escalation"],
        skill_affinity=["communication", "product"],
        tier=1,
    ),
    "neurometric/empathy-edge": ModelInfo(
        id="neurometric/empathy-edge",
        name="Empathy Edge",
        category=ModelCategory.SUPPORT,
        description="Empathetic customer communication.",
        best_for=["empathetic responses", "difficult conversations", "de-escalation"],
        skill_affinity=["communication"],
        tier=1,
    ),
    "neurometric/dev-link": ModelInfo(
        id="neurometric/dev-link",
        name="Dev Link",
        category=ModelCategory.SUPPORT,
        description="Links support tickets to technical solutions.",
        best_for=["technical support", "bug linking", "solution matching"],
        skill_affinity=["debugging", "documentation"],
        tier=1,
    ),
    "neurometric/trouble-shoot": ModelInfo(
        id="neurometric/trouble-shoot",
        name="Troubleshooter",
        category=ModelCategory.SUPPORT,
        description="Technical troubleshooting guidance.",
        best_for=["troubleshooting", "diagnostic guidance", "step-by-step fixes"],
        skill_affinity=["debugging", "devops"],
        tier=2,
    ),
    "neurometric/ticket-clean": ModelInfo(
        id="neurometric/ticket-clean",
        name="Ticket Cleaner",
        category=ModelCategory.SUPPORT,
        description="Ticket deduplication and cleanup.",
        best_for=["ticket management", "deduplication", "cleanup"],
        skill_affinity=["quality"],
        tier=1,
    ),

    # ========================================================================
    # DATA/ANALYTICS MODELS
    # ========================================================================
    "neurometric/chart-mapper": ModelInfo(
        id="neurometric/chart-mapper",
        name="Chart Mapper",
        category=ModelCategory.DATA,
        description="Data visualization and chart generation.",
        best_for=["data visualization", "chart creation", "dashboard design"],
        skill_affinity=["data", "frontend"],
        tier=1,
    ),
    "neurometric/anomaly-sense": ModelInfo(
        id="neurometric/anomaly-sense",
        name="Anomaly Sense",
        category=ModelCategory.DATA,
        description="Anomaly detection in data streams.",
        best_for=["anomaly detection", "outlier identification", "data quality"],
        skill_affinity=["data", "performance"],
        tier=2,
    ),
    "neurometric/trend-spotter": ModelInfo(
        id="neurometric/trend-spotter",
        name="Trend Spotter",
        category=ModelCategory.DATA,
        description="Trend analysis and pattern recognition.",
        best_for=["trend analysis", "pattern recognition", "forecasting"],
        skill_affinity=["data", "product"],
        tier=2,
    ),
    "neurometric/growth-index": ModelInfo(
        id="neurometric/growth-index",
        name="Growth Index",
        category=ModelCategory.DATA,
        description="Growth metrics and indexing.",
        best_for=["growth analysis", "metric tracking", "KPI monitoring"],
        skill_affinity=["data", "product"],
        tier=1,
    ),
    "neurometric/account-pulse": ModelInfo(
        id="neurometric/account-pulse",
        name="Account Pulse",
        category=ModelCategory.DATA,
        description="Account health monitoring.",
        best_for=["account health", "customer success", "engagement tracking"],
        skill_affinity=["data", "product"],
        tier=1,
    ),

    # ========================================================================
    # DOCUMENT/CONTENT MODELS
    # ========================================================================
    "neurometric/prd-draft": ModelInfo(
        id="neurometric/prd-draft",
        name="PRD Drafter",
        category=ModelCategory.DOCUMENT,
        description="Product Requirements Document generation.",
        best_for=["PRD creation", "product specs", "requirement docs"],
        skill_affinity=["product", "planning", "documentation"],
        tier=2,
    ),
    "neurometric/design-doc": ModelInfo(
        id="neurometric/design-doc",
        name="Design Doc Writer",
        category=ModelCategory.DOCUMENT,
        description="Technical design document generation.",
        best_for=["design docs", "architecture docs", "technical specs"],
        skill_affinity=["architecture", "documentation", "planning"],
        tier=2,
    ),
    "neurometric/release-logs": ModelInfo(
        id="neurometric/release-logs",
        name="Release Logger",
        category=ModelCategory.DOCUMENT,
        description="Release notes and changelog generation.",
        best_for=["release notes", "changelogs", "version documentation"],
        skill_affinity=["documentation", "git"],
        tier=1,
    ),
    "neurometric/handbook-bot": ModelInfo(
        id="neurometric/handbook-bot",
        name="Handbook Bot",
        category=ModelCategory.DOCUMENT,
        description="Employee handbook and policy documentation.",
        best_for=["handbooks", "policies", "procedures"],
        skill_affinity=["documentation", "onboarding"],
        tier=1,
    ),
    "neurometric/doc-master": ModelInfo(
        id="neurometric/doc-master",
        name="Document Master",
        category=ModelCategory.DOCUMENT,
        description="Comprehensive document generation and review.",
        best_for=["document creation", "review", "formatting"],
        skill_affinity=["documentation", "quality"],
        tier=2,
    ),
    "neurometric/research-synth": ModelInfo(
        id="neurometric/research-synth",
        name="Research Synthesizer",
        category=ModelCategory.DOCUMENT,
        description="Synthesizes research from multiple sources.",
        best_for=["research synthesis", "literature review", "analysis"],
        skill_affinity=["research", "documentation"],
        tier=2,
    ),
    "neurometric/pr-summarizer": ModelInfo(
        id="neurometric/pr-summarizer",
        name="PR Summarizer",
        category=ModelCategory.DOCUMENT,
        description="Pull request summarization.",
        best_for=["PR summaries", "code review notes", "change documentation"],
        skill_affinity=["git", "documentation", "quality"],
        tier=1,
    ),
    "neurometric/meeting-prep": ModelInfo(
        id="neurometric/meeting-prep",
        name="Meeting Prep",
        category=ModelCategory.DOCUMENT,
        description="Meeting preparation and agenda generation.",
        best_for=["meeting prep", "agenda creation", "briefing docs"],
        skill_affinity=["planning", "communication"],
        tier=1,
    ),
    "neurometric/briefing-bot": ModelInfo(
        id="neurometric/briefing-bot",
        name="Briefing Bot",
        category=ModelCategory.DOCUMENT,
        description="Executive briefing generation.",
        best_for=["executive briefs", "status reports", "summaries"],
        skill_affinity=["communication", "documentation"],
        tier=1,
    ),

    # ========================================================================
    # OPERATIONS MODELS
    # ========================================================================
    "neurometric/eisenhower-bot": ModelInfo(
        id="neurometric/eisenhower-bot",
        name="Eisenhower Bot",
        category=ModelCategory.OPERATIONS,
        description="Priority matrix and task prioritization.",
        best_for=["task prioritization", "urgency analysis", "time management"],
        skill_affinity=["planning", "product"],
        tier=1,
    ),
    "neurometric/milestone-check": ModelInfo(
        id="neurometric/milestone-check",
        name="Milestone Checker",
        category=ModelCategory.OPERATIONS,
        description="Milestone tracking and progress assessment.",
        best_for=["milestone tracking", "progress review", "deadline management"],
        skill_affinity=["planning", "product"],
        tier=1,
    ),
    "neurometric/goal-setter": ModelInfo(
        id="neurometric/goal-setter",
        name="Goal Setter",
        category=ModelCategory.OPERATIONS,
        description="OKR and goal setting assistance.",
        best_for=["OKR creation", "goal setting", "objective planning"],
        skill_affinity=["planning", "product"],
        tier=1,
    ),
    "neurometric/urgency-sort": ModelInfo(
        id="neurometric/urgency-sort",
        name="Urgency Sorter",
        category=ModelCategory.OPERATIONS,
        description="Task urgency classification.",
        best_for=["urgency sorting", "priority classification", "triage"],
        skill_affinity=["planning"],
        tier=1,
    ),
    "neurometric/tidy-drive": ModelInfo(
        id="neurometric/tidy-drive",
        name="Tidy Drive",
        category=ModelCategory.OPERATIONS,
        description="File and drive organization.",
        best_for=["file organization", "drive cleanup", "structure optimization"],
        skill_affinity=["quality"],
        tier=1,
    ),
    "neurometric/sign-flow": ModelInfo(
        id="neurometric/sign-flow",
        name="Sign Flow",
        category=ModelCategory.OPERATIONS,
        description="Signature and approval workflow.",
        best_for=["approval workflows", "signature routing", "document flow"],
        skill_affinity=["planning", "product"],
        tier=1,
    ),

    # ========================================================================
    # SPECIALIZED MODELS
    # ========================================================================
    "neurometric/owlpack-general": ModelInfo(
        id="neurometric/owlpack-general",
        name="OwlPack General",
        category=ModelCategory.SPECIALIZED,
        description="General-purpose alternative to ClawPack.",
        best_for=["general tasks", "alternative reasoning", "diverse perspectives"],
        skill_affinity=["neuro", "planning", "architecture"],
        tier=2,
    ),
    "neurometric/waveformintelligence-text2sql": ModelInfo(
        id="neurometric/waveformintelligence-text2sql",
        name="Text-to-SQL",
        category=ModelCategory.SPECIALIZED,
        description="Natural language to SQL query conversion.",
        best_for=["SQL generation", "database queries", "data extraction"],
        skill_affinity=["data"],
        tier=2,
    ),
    "neurometric/email-priority-classifier": ModelInfo(
        id="neurometric/email-priority-classifier",
        name="Email Priority Classifier",
        category=ModelCategory.SPECIALIZED,
        description="Email priority and categorization.",
        best_for=["email triage", "priority sorting", "inbox management"],
        skill_affinity=["product", "operations"],
        tier=1,
    ),
    "neurometric/resume-parser": ModelInfo(
        id="neurometric/resume-parser",
        name="Resume Parser",
        category=ModelCategory.SPECIALIZED,
        description="Resume parsing and skill extraction.",
        best_for=["resume analysis", "skill extraction", "candidate screening"],
        skill_affinity=["hr", "data"],
        tier=1,
    ),
    "neurometric/seed-pitch-classifier": ModelInfo(
        id="neurometric/seed-pitch-classifier",
        name="Seed Pitch Classifier",
        category=ModelCategory.SPECIALIZED,
        description="Startup pitch analysis and classification.",
        best_for=["pitch analysis", "startup evaluation", "investment screening"],
        skill_affinity=["product", "data"],
        tier=2,
    ),

    # ========================================================================
    # SPORTS/ANALYTICS MODELS
    # ========================================================================
    "neurometric/sportsvisio-game-report": ModelInfo(
        id="neurometric/sportsvisio-game-report",
        name="Game Report",
        category=ModelCategory.SPECIALIZED,
        description="Sports game analysis and reporting.",
        best_for=["game analysis", "sports reporting", "performance review"],
        skill_affinity=["data", "documentation"],
        tier=1,
    ),
    "neurometric/sportsvisio-marketing-recap": ModelInfo(
        id="neurometric/sportsvisio-marketing-recap",
        name="Marketing Recap",
        category=ModelCategory.MARKETING,
        description="Marketing campaign recap and analysis.",
        best_for=["campaign analysis", "marketing reports", "performance review"],
        skill_affinity=["data", "documentation"],
        tier=1,
    ),
    "neurometric/sportsvisio-marketing-social": ModelInfo(
        id="neurometric/sportsvisio-marketing-social",
        name="Social Media Marketing",
        category=ModelCategory.MARKETING,
        description="Social media content and strategy.",
        best_for=["social media", "content strategy", "engagement"],
        skill_affinity=["communication", "product"],
        tier=1,
    ),
    "neurometric/sportsvisio-marketing-research": ModelInfo(
        id="neurometric/sportsvisio-marketing-research",
        name="Marketing Research",
        category=ModelCategory.MARKETING,
        description="Market research and competitive analysis.",
        best_for=["market research", "competitive analysis", "industry trends"],
        skill_affinity=["research", "product"],
        tier=2,
    ),
    "neurometric/sportsvisio-marketing-newsletter": ModelInfo(
        id="neurometric/sportsvisio-marketing-newsletter",
        name="Newsletter Writer",
        category=ModelCategory.MARKETING,
        description="Newsletter content generation.",
        best_for=["newsletters", "email marketing", "content creation"],
        skill_affinity=["communication", "documentation"],
        tier=1,
    ),
    "neurometric/sportsvisio-marketing-casestudy": ModelInfo(
        id="neurometric/sportsvisio-marketing-casestudy",
        name="Case Study Writer",
        category=ModelCategory.MARKETING,
        description="Customer case study generation.",
        best_for=["case studies", "customer stories", "proof points"],
        skill_affinity=["documentation", "communication"],
        tier=1,
    ),
    "neurometric/sportsvisio-marketing-seo": ModelInfo(
        id="neurometric/sportsvisio-marketing-seo",
        name="SEO Specialist",
        category=ModelCategory.MARKETING,
        description="SEO optimization and content ranking.",
        best_for=["SEO", "content optimization", "ranking strategy"],
        skill_affinity=["documentation", "product"],
        tier=1,
    ),
    "neurometric/sportsvisio-finance": ModelInfo(
        id="neurometric/sportsvisio-finance",
        name="Sports Finance",
        category=ModelCategory.FINANCE,
        description="Sports industry financial analysis.",
        best_for=["sports finance", "player contracts", "team valuations"],
        skill_affinity=["data", "finance"],
        tier=2,
    ),

    # ========================================================================
    # NEURO-SPECIFIC MODELS
    # ========================================================================
    "neurometric/aiera-summarizer": ModelInfo(
        id="neurometric/aiera-summarizer",
        name="AIERA Summarizer",
        category=ModelCategory.SPECIALIZED,
        description="AI-powered event and meeting summarization.",
        best_for=["meeting summaries", "event notes", "transcription"],
        skill_affinity=["documentation", "communication"],
        tier=1,
    ),
    "neurometric/conversation-restart": ModelInfo(
        id="neurometric/conversation-restart",
        name="Conversation Restart",
        category=ModelCategory.SPECIALIZED,
        description="Resumes and restarts conversations with context.",
        best_for=["context restoration", "conversation resumption", "memory recall"],
        skill_affinity=["exhaustive-crosscheck"],
        tier=1,
    ),
    "neurometric/scorer-v5": ModelInfo(
        id="neurometric/scorer-v5",
        name="Scorer V5",
        category=ModelCategory.SPECIALIZED,
        description="Content scoring and quality assessment.",
        best_for=["content scoring", "quality assessment", "ranking"],
        skill_affinity=["quality", "testing"],
        tier=2,
    ),
    "neurometric/css-resume-scorer": ModelInfo(
        id="neurometric/css-resume-scorer",
        name="CSS Resume Scorer",
        category=ModelCategory.SPECIALIZED,
        description="Resume scoring for CSS/design roles.",
        best_for=["design resume screening", "CSS skill assessment"],
        skill_affinity=["frontend"],
        tier=1,
    ),
    "neurometric/manager-coach": ModelInfo(
        id="neurometric/manager-coach",
        name="Manager Coach",
        category=ModelCategory.SPECIALIZED,
        description="Management coaching and leadership guidance.",
        best_for=["leadership coaching", "management advice", "team dynamics"],
        skill_affinity=["product", "communication"],
        tier=2,
    ),
    "neurometric/radical-candor": ModelInfo(
        id="neurometric/radical-candor",
        name="Radical Candor",
        category=ModelCategory.SPECIALIZED,
        description="Direct and caring feedback generation.",
        best_for=["feedback delivery", "performance reviews", "coaching"],
        skill_affinity=["communication", "product"],
        tier=1,
    ),
    "neurometric/townhall-brief": ModelInfo(
        id="neurometric/townhall-brief",
        name="Townhall Brief",
        category=ModelCategory.SPECIALIZED,
        description="All-hands meeting briefing and Q&A prep.",
        best_for=["townhall prep", "executive Q&A", "company updates"],
        skill_affinity=["communication", "planning"],
        tier=1,
    ),
    "neurometric/mediator-ai": ModelInfo(
        id="neurometric/mediator-ai",
        name="Mediator AI",
        category=ModelCategory.SPECIALIZED,
        description="Conflict mediation and resolution.",
        best_for=["conflict resolution", "dispute mediation", "team harmony"],
        skill_affinity=["communication"],
        tier=2,
    ),
    "neurometric/shoutout-gen": ModelInfo(
        id="neurometric/shoutout-gen",
        name="Shoutout Generator",
        category=ModelCategory.SPECIALIZED,
        description="Employee recognition and shoutout creation.",
        best_for=["recognition", "shoutouts", "team morale"],
        skill_affinity=["communication"],
        tier=1,
    ),
    "neurometric/adr-writer": ModelInfo(
        id="neurometric/adr-writer",
        name="ADR Writer",
        category=ModelCategory.CODE,
        description="Architecture Decision Record generation.",
        best_for=["ADR creation", "decision documentation", "architecture records"],
        skill_affinity=["architecture", "documentation"],
        tier=2,
    ),
    "neurometric/extract-ai": ModelInfo(
        id="neurometric/extract-ai",
        name="Extract AI",
        category=ModelCategory.DATA,
        description="Data extraction from unstructured text.",
        best_for=["data extraction", "entity recognition", "text parsing"],
        skill_affinity=["data", "research"],
        tier=2,
    ),
    "neurometric/rec-engine": ModelInfo(
        id="neurometric/rec-engine",
        name="Recommendation Engine",
        category=ModelCategory.SPECIALIZED,
        description="Recommendation generation based on context.",
        best_for=["recommendations", "suggestions", "next actions"],
        skill_affinity=["product", "planning"],
        tier=2,
    ),
    "neurometric/debt-scan": ModelInfo(
        id="neurometric/debt-scan",
        name="Debt Scanner",
        category=ModelCategory.FINANCE,
        description="Financial debt analysis and scanning.",
        best_for=["debt analysis", "liability scanning", "financial health"],
        skill_affinity=["data", "finance"],
        tier=2,
    ),
    "neurometric/erd-creator": ModelInfo(
        id="neurometric/erd-creator",
        name="ERD Creator",
        category=ModelCategory.CODE,
        description="Entity Relationship Diagram creation.",
        best_for=["ERD generation", "database design", "schema visualization"],
        skill_affinity=["architecture", "data"],
        tier=2,
    ),
    "neurometric/feature-adopter": ModelInfo(
        id="neurometric/feature-adopter",
        name="Feature Adopter",
        category=ModelCategory.PRODUCT,
        description="Feature adoption tracking and analysis.",
        best_for=["adoption tracking", "feature usage", "user engagement"],
        skill_affinity=["data", "product"],
        tier=1,
    ),
    "neurometric/loss-review": ModelInfo(
        id="neurometric/loss-review",
        name="Loss Review",
        category=ModelCategory.FINANCE,
        description="Financial loss analysis and prevention.",
        best_for=["loss analysis", "prevention strategy", "risk mitigation"],
        skill_affinity=["data", "finance"],
        tier=2,
    ),
    "neurometric/csm-summary": ModelInfo(
        id="neurometric/csm-summary",
        name="CSM Summary",
        category=ModelCategory.SUPPORT,
        description="Customer Success Manager summary generation.",
        best_for=["CSM reports", "customer health", "success metrics"],
        skill_affinity=["communication", "data"],
        tier=1,
    ),
    "neurometric/upgrade-assist": ModelInfo(
        id="neurometric/upgrade-assist",
        name="Upgrade Assistant",
        category=ModelCategory.SUPPORT,
        description="Upgrade path recommendation and assistance.",
        best_for=["upgrade planning", "migration guidance", "version upgrades"],
        skill_affinity=["devops", "documentation"],
        tier=1,
    ),
    "neurometric/inbox-guard": ModelInfo(
        id="neurometric/inbox-guard",
        name="Inbox Guard",
        category=ModelCategory.OPERATIONS,
        description="Email inbox management and filtering.",
        best_for=["email filtering", "inbox management", "priority sorting"],
        skill_affinity=["product", "operations"],
        tier=1,
    ),
    "neurometric/receipt-ref": ModelInfo(
        id="neurometric/receipt-ref",
        name="Receipt Reference",
        category=ModelCategory.FINANCE,
        description="Receipt processing and reference.",
        best_for=["receipt processing", "expense tracking", "documentation"],
        skill_affinity=["data"],
        tier=1,
    ),
    "neurometric/digital-post": ModelInfo(
        id="neurometric/digital-post",
        name="Digital Post",
        category=ModelCategory.MARKETING,
        description="Digital content posting and scheduling.",
        best_for=["content scheduling", "digital posting", "social media"],
        skill_affinity=["communication", "product"],
        tier=1,
    ),
    "neurometric/deal-sieve": ModelInfo(
        id="neurometric/deal-sieve",
        name="Deal Sieve",
        category=ModelCategory.SALES,
        description="Deal qualification and filtering.",
        best_for=["deal qualification", "opportunity filtering", "sales pipeline"],
        skill_affinity=["product", "data"],
        tier=1,
    ),
    "neurometric/quote-fixer": ModelInfo(
        id="neurometric/quote-fixer",
        name="Quote Fixer",
        category=ModelCategory.SALES,
        description="Quote generation and optimization.",
        best_for=["quote creation", "pricing optimization", "proposal generation"],
        skill_affinity=["product", "communication"],
        tier=1,
    ),
    "neurometric/precedent-finder": ModelInfo(
        id="neurometric/precedent-finder",
        name="Precedent Finder",
        category=ModelCategory.LEGAL,
        description="Legal precedent search and analysis.",
        best_for=["precedent research", "case law", "legal analysis"],
        skill_affinity=["research", "documentation"],
        tier=2,
    ),
    "neurometric/exhibit-list": ModelInfo(
        id="neurometric/exhibit-list",
        name="Exhibit List",
        category=ModelCategory.LEGAL,
        description="Exhibit list creation and management.",
        best_for=["exhibit management", "trial preparation", "document organization"],
        skill_affinity=["documentation", "planning"],
        tier=1,
    ),
    "neurometric/line-item-ai": ModelInfo(
        id="neurometric/line-item-ai",
        name="Line Item AI",
        category=ModelCategory.FINANCE,
        description="Line item analysis and categorization.",
        best_for=["line item review", "budget analysis", "expense categorization"],
        skill_affinity=["data", "finance"],
        tier=1,
    ),
    "neurometric/rent-logic": ModelInfo(
        id="neurometric/rent-logic",
        name="Rent Logic",
        category=ModelCategory.FINANCE,
        description="Rental analysis and optimization.",
        best_for=["rental analysis", "property evaluation", "market comparison"],
        skill_affinity=["data", "finance"],
        tier=1,
    ),
    "neurometric/scribe-reader": ModelInfo(
        id="neurometric/scribe-reader",
        name="Scribe Reader",
        category=ModelCategory.DOCUMENT,
        description="Document reading and summarization.",
        best_for=["document analysis", "content extraction", "summarization"],
        skill_affinity=["research", "documentation"],
        tier=1,
    ),
    "neurometric/grid-master": ModelInfo(
        id="neurometric/grid-master",
        name="Grid Master",
        category=ModelCategory.DATA,
        description="Spreadsheet and grid data management.",
        best_for=["spreadsheet analysis", "grid operations", "data management"],
        skill_affinity=["data"],
        tier=1,
    ),
    "neurometric/bill-sieve": ModelInfo(
        id="neurometric/bill-sieve",
        name="Bill Sieve",
        category=ModelCategory.FINANCE,
        description="Bill processing and filtering.",
        best_for=["bill processing", "invoice management", "payment tracking"],
        skill_affinity=["data", "finance"],
        tier=1,
    ),
    "neurometric/policy-puller": ModelInfo(
        id="neurometric/policy-puller",
        name="Policy Puller",
        category=ModelCategory.OPERATIONS,
        description="Policy document retrieval and analysis.",
        best_for=["policy lookup", "compliance checking", "procedure review"],
        skill_affinity=["research", "documentation"],
        tier=1,
    ),
    "neurometric/profile-builder": ModelInfo(
        id="neurometric/profile-builder",
        name="Profile Builder",
        category=ModelCategory.HR,
        description="Professional profile creation and optimization.",
        best_for=["profile creation", "LinkedIn optimization", "personal branding"],
        skill_affinity=["communication", "product"],
        tier=1,
    ),
    "neurometric/resume-query-refiner": ModelInfo(
        id="neurometric/resume-query-refiner",
        name="Resume Query Refiner",
        category=ModelCategory.HR,
        description="Resume search query optimization.",
        best_for=["resume search", "query optimization", "candidate sourcing"],
        skill_affinity=["data", "hr"],
        tier=1,
    ),
    "neurometric/resume-job-matcher": ModelInfo(
        id="neurometric/resume-job-matcher",
        name="Resume-Job Matcher",
        category=ModelCategory.HR,
        description="Resume to job description matching.",
        best_for=["candidate matching", "skill alignment", "hiring optimization"],
        skill_affinity=["data", "hr"],
        tier=2,
    ),
    "neurometric/bol-scanner": ModelInfo(
        id="neurometric/bol-scanner",
        name="BOL Scanner",
        category=ModelCategory.OPERATIONS,
        description="Bill of Lading scanning and processing.",
        best_for=["BOL processing", "shipping documents", "logistics"],
        skill_affinity=["data"],
        tier=1,
    ),
    "neurometric/terms-finder": ModelInfo(
        id="neurometric/terms-finder",
        name="Terms Finder",
        category=ModelCategory.LEGAL,
        description="Terms and conditions extraction.",
        best_for=["terms extraction", "contract analysis", "legal review"],
        skill_affinity=["research", "documentation"],
        tier=1,
    ),
    "neurometric/intent-sorter": ModelInfo(
        id="neurometric/intent-sorter",
        name="Intent Sorter",
        category=ModelCategory.SPECIALIZED,
        description="User intent classification and sorting.",
        best_for=["intent classification", "query routing", "understanding user needs"],
        skill_affinity=["product", "communication"],
        tier=1,
    ),
    "neurometric/plate-parser": ModelInfo(
        id="neurometric/plate-parser",
        name="Plate Parser",
        category=ModelCategory.SPECIALIZED,
        description="License plate recognition and parsing.",
        best_for=["plate recognition", "vehicle identification", "OCR"],
        skill_affinity=["data"],
        tier=1,
    ),
    "neurometric/form-helper": ModelInfo(
        id="neurometric/form-helper",
        name="Form Helper",
        category=ModelCategory.OPERATIONS,
        description="Form filling and assistance.",
        best_for=["form completion", "data entry", "document processing"],
        skill_affinity=["data", "operations"],
        tier=1,
    ),
    "neurometric/source-verify": ModelInfo(
        id="neurometric/source-verify",
        name="Source Verifier",
        category=ModelCategory.SPECIALIZED,
        description="Source verification and fact-checking.",
        best_for=["fact verification", "source validation", "credibility checking"],
        skill_affinity=["research", "quality"],
        tier=2,
    ),
    "neurometric/sku-architect": ModelInfo(
        id="neurometric/sku-architect",
        name="SKU Architect",
        category=ModelCategory.OPERATIONS,
        description="SKU structure design and management.",
        best_for=["SKU design", "product categorization", "inventory management"],
        skill_affinity=["product", "data"],
        tier=1,
    ),
    "neurometric/reply-draft": ModelInfo(
        id="neurometric/reply-draft",
        name="Reply Drafter",
        category=ModelCategory.COMMUNICATION,
        description="Email and message reply drafting.",
        best_for=["email replies", "message drafting", "response generation"],
        skill_affinity=["communication"],
        tier=1,
    ),
    "neurometric/slack-router": ModelInfo(
        id="neurometric/slack-router",
        name="Slack Router",
        category=ModelCategory.COMMUNICATION,
        description="Slack message routing and prioritization.",
        best_for=["message routing", "slack management", "communication sorting"],
        skill_affinity=["communication", "product"],
        tier=1,
    ),
    "neurometric/l&d-advisor": ModelInfo(
        id="neurometric/l&d-advisor",
        name="L&D Advisor",
        category=ModelCategory.HR,
        description="Learning and development guidance.",
        best_for=["training planning", "skill development", "career growth"],
        skill_affinity=["onboarding", "product"],
        tier=1,
    ),
    "neurometric/pay-clarifier": ModelInfo(
        id="neurometric/pay-clarifier",
        name="Pay Clarifier",
        category=ModelCategory.HR,
        description="Compensation and pay clarification.",
        best_for=["compensation analysis", "pay transparency", "salary benchmarking"],
        skill_affinity=["data", "hr"],
        tier=1,
    ),
}


# ---------------------------------------------------------------------------
# HELPER FUNCTIONS
# ---------------------------------------------------------------------------

def get_model(model_id: str) -> ModelInfo | None:
    """Get model info by ID."""
    return MODELS.get(model_id)


def get_models_by_category(category: ModelCategory) -> list[ModelInfo]:
    """Get all models in a category."""
    return [m for m in MODELS.values() if m.category == category]


def get_models_by_skill(skill_id: str) -> list[ModelInfo]:
    """Get all models that affinity with a skill."""
    return [m for m in MODELS.values() if skill_id in m.skill_affinity]


def get_models_by_tier(tier: int) -> list[ModelInfo]:
    """Get all models at a specific tier."""
    return [m for m in MODELS.values() if m.tier == tier]


def search_models(query: str) -> list[ModelInfo]:
    """Search models by name or description."""
    query_lower = query.lower()
    return [
        m for m in MODELS.values()
        if query_lower in m.name.lower()
        or query_lower in m.description.lower()
        or any(query_lower in bf for bf in m.best_for)
    ]


def get_model_ids() -> list[str]:
    """Get all model IDs."""
    return list(MODELS.keys())


def get_model_count() -> int:
    """Get total model count."""
    return len(MODELS)


# ---------------------------------------------------------------------------
# CHAIN DETECTION — Which models can chain together
# ---------------------------------------------------------------------------

def get_chainable_models(model_id: str) -> list[ModelInfo]:
    """Get models that can chain with the given model."""
    model = MODELS.get(model_id)
    if not model:
        return []
    return [MODELS[mid] for mid in model.can_chain_with if mid in MODELS]


def can_models_chain(model_a_id: str, model_b_id: str) -> bool:
    """Check if model A can chain into model B."""
    model_a = MODELS.get(model_a_id)
    if not model_a:
        return False
    return model_b_id in model_a.can_chain_with


def get_chain_length(model_id: str, visited: set | None = None) -> int:
    """Get the maximum chain length starting from a model."""
    if visited is None:
        visited = set()
    if model_id in visited:
        return 0
    visited.add(model_id)
    model = MODELS.get(model_id)
    if not model or not model.can_chain_with:
        return 1
    return 1 + max(
        get_chain_length(next_id, visited.copy())
        for next_id in model.can_chain_with
    )


def get_decomposition(model_id: str) -> list[ModelInfo]:
    """Get sub-models a model decomposes into."""
    model = MODELS.get(model_id)
    if not model:
        return []
    return [MODELS[mid] for mid in model.decomposes_to if mid in MODELS]


# ---------------------------------------------------------------------------
# PREDEFINED CHAINS — Common multi-model workflows
# ---------------------------------------------------------------------------

PREDEFINED_CHAINS: dict[str, dict] = {
    "full_code_review": {
        "description": "Complete code review with security and quality checks",
        "steps": [
            {"model": "neurometric/clawpack-coding", "mode": "sequential", "purpose": "Code analysis"},
            {"model": "neurometric/auth-guard", "mode": "parallel", "purpose": "Security check"},
            {"model": "neurometric/style-fixer", "mode": "parallel", "purpose": "Style validation"},
            {"model": "neurometric/clawpack-pro", "mode": "sequential", "purpose": "Deep analysis"},
        ],
    },
    "security_audit": {
        "description": "Comprehensive security audit",
        "steps": [
            {"model": "neurometric/auth-guard", "mode": "sequential", "purpose": "Auth review"},
            {"model": "neurometric/reg-compliance", "mode": "parallel", "purpose": "Compliance check"},
            {"model": "neurometric/policy-check", "mode": "parallel", "purpose": "Policy validation"},
            {"model": "neurometric/contract-risk-analyzer", "mode": "sequential", "purpose": "Risk analysis"},
        ],
    },
    "feature_development": {
        "description": "End-to-end feature development",
        "steps": [
            {"model": "neurometric/prd-draft", "mode": "sequential", "purpose": "Requirements"},
            {"model": "neurometric/design-doc", "mode": "sequential", "purpose": "Design"},
            {"model": "neurometric/code-writer", "mode": "sequential", "purpose": "Implementation"},
            {"model": "neurometric/code-refactorer", "mode": "parallel", "purpose": "Refactoring"},
            {"model": "neurometric/style-fixer", "mode": "parallel", "purpose": "Style"},
        ],
    },
    "financial_analysis": {
        "description": "Financial risk and performance analysis",
        "steps": [
            {"model": "neurometric/cash-flow-ref", "mode": "sequential", "purpose": "Cash flow"},
            {"model": "neurometric/ratio-analyzer", "mode": "parallel", "purpose": "Ratios"},
            {"model": "neurometric/risk-evaluator", "mode": "sequential", "purpose": "Risk"},
            {"model": "neurometric/forecast-narrator", "mode": "sequential", "purpose": "Narrative"},
        ],
    },
    "hr_workflow": {
        "description": "Hiring and HR workflow",
        "steps": [
            {"model": "neurometric/jd-writer", "mode": "sequential", "purpose": "Job description"},
            {"model": "neurometric/bias-check", "mode": "parallel", "purpose": "Bias check"},
            {"model": "neurometric/resume-parser", "mode": "sequential", "purpose": "Resume parsing"},
            {"model": "neurometric/interview-analyst", "mode": "sequential", "purpose": "Interview analysis"},
            {"model": "neurometric/offer-architect", "mode": "sequential", "purpose": "Offer creation"},
        ],
    },
    "documentation_pipeline": {
        "description": "Complete documentation generation",
        "steps": [
            {"model": "neurometric/prd-draft", "mode": "optional", "purpose": "PRD if needed"},
            {"model": "neurometric/design-doc", "mode": "sequential", "purpose": "Design doc"},
            {"model": "neurometric/doc-master", "mode": "sequential", "purpose": "Documentation"},
            {"model": "neurometric/release-logs", "mode": "parallel", "purpose": "Changelog"},
        ],
    },
    "data_pipeline": {
        "description": "Data analysis and visualization",
        "steps": [
            {"model": "neurometric/extract-ai", "mode": "sequential", "purpose": "Data extraction"},
            {"model": "neurometric/chart-mapper", "mode": "parallel", "purpose": "Visualization"},
            {"model": "neurometric/anomaly-sense", "mode": "parallel", "purpose": "Anomaly detection"},
            {"model": "neurometric/trend-spotter", "mode": "sequential", "purpose": "Trend analysis"},
        ],
    },
    "marketing_campaign": {
        "description": "Marketing campaign creation",
        "steps": [
            {"model": "neurometric/keyword-king", "mode": "sequential", "purpose": "Keyword research"},
            {"model": "neurometric/promo-writer", "mode": "sequential", "purpose": "Content creation"},
            {"model": "neurometric/tone-checker", "mode": "parallel", "purpose": "Brand consistency"},
            {"model": "neurometric/ppc-pilot", "mode": "parallel", "purpose": "Ad optimization"},
        ],
    },
    "support_escalation": {
        "description": "Customer support escalation handling",
        "steps": [
            {"model": "neurometric/support-poly", "mode": "sequential", "purpose": "Ticket routing"},
            {"model": "neurometric/empathy-edge", "mode": "parallel", "purpose": "Empathetic response"},
            {"model": "neurometric/trouble-shoot", "mode": "sequential", "purpose": "Technical resolution"},
            {"model": "neurometric/csm-summary", "mode": "sequential", "purpose": "Summary"},
        ],
    },
}


def get_predefined_chain(chain_name: str) -> dict | None:
    """Get a predefined chain by name."""
    return PREDEFINED_CHAINS.get(chain_name)


def get_all_chain_names() -> list[str]:
    """Get all predefined chain names."""
    return list(PREDEFINED_CHAINS.keys())


def get_chains_for_task(task_type: str) -> list[str]:
    """Get predefined chains relevant to a task type."""
    task_to_chains = {
        "code_review": ["full_code_review"],
        "security_review": ["security_audit"],
        "feature_development": ["feature_development"],
        "financial_analysis": ["financial_analysis"],
        "hr_task": ["hr_workflow"],
        "documentation": ["documentation_pipeline"],
        "data_analysis": ["data_pipeline"],
        "marketing": ["marketing_campaign"],
        "support": ["support_escalation"],
    }
    return task_to_chains.get(task_type, [])


# ---------------------------------------------------------------------------
# EXPORT FOR USE
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"NEURO Model Registry: {get_model_count()} models")
    print()
    for cat in ModelCategory:
        models = get_models_by_category(cat)
        if models:
            print(f"  {cat.value.upper()} ({len(models)} models):")
            for m in models[:5]:
                chain_count = len(m.can_chain_with)
                print(f"    - {m.name} (tier {m.tier}, chains: {chain_count})")
            if len(models) > 5:
                print(f"    ... and {len(models) - 5} more")
    print()
    print(f"Predefined chains: {len(PREDEFINED_CHAINS)}")
    for name in PREDEFINED_CHAINS:
        print(f"  - {name}")
