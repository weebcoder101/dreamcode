---
name: communication
description: "Communication standards for explaining technical concepts to different audiences. Use when presenting results, writing explanations, or preparing presentations."
chains_with:
  - automated-learning
---

# Communication Skill — Explain Anything to Anyone

## Audience Levels

### Executive / Non-Technical
- Start with the conclusion (one sentence)
- Use analogies, not jargon
- Lead with business impact
- One number per slide
- Say "what it means," not "how it works"

**Example**: "Our risk model shows a 1-in-20 chance of losing more than 1.36% in a day. That's within acceptable bounds."

### Technical Peer
- State the problem and approach concisely
- Share key numbers and methodology
- Mention caveats and trade-offs
- Offer to go deeper if interested
- Reference code/files for details

**Example**: "VaR 95% is -1.36% from historical simulation, $10,716 from hybrid MC. The difference is methodology: one uses past returns, the other simulates forward."

### Expert / Researcher
- Lead with nuance
- Discuss methodology choices and alternatives
- Reference literature and theory
- Share raw data and benchmarks
- Invite scrutiny of assumptions

**Example**: "We chose GARCH(1,1) over EGARCH for simplicity — the asymmetry didn't justify the complexity for our 14-asset universe at p<0.05."

## Explanation Framework

### The 3-Sentence Rule
1. **What** (one sentence): The core idea
2. **How** (one sentence): The mechanism
3. **Why** (one sentence): The significance

### Example — Hybrid MC
1. "Hybrid Monte Carlo simulates thousands of possible portfolio outcomes."
2. "It combines GARCH volatility with Vine Copula dependencies to generate realistic joint scenarios."
3. "This gives us more accurate tail-risk estimates than standard parametric methods."

## Presentation Tips

### Slide Structure
- One idea per slide
- Title is the conclusion
- Visuals > text
- Data labels on charts
- Source annotations at bottom

### Talking Points
- Practice the transition between slides
- Prepare 3 levels of detail for each topic
- Anticipate likely questions
- Have a "one-minute version" ready

## Writing Voice

- Active voice: "The model computes VaR" NOT "VaR is computed by the model"
- Short sentences: < 25 words
- One idea per paragraph
- Bullet lists for parallel concepts
- Numbers at the start: "3 key findings..."
