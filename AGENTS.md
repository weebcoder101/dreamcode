# DreamCode Branch Policy

## Critical Rule: NEVER modify `stable-release` directly

**`stable-release` is the gold release branch. It is read-only for development.**

## Workflow

1. Create a test branch from `stable-release`:
   ```
   git checkout -b test-v<version> stable-release
   ```

2. Make all changes exclusively on test branches.

3. Every new change must start with a fresh branch from `stable-release`.

4. The `stable-release` branch is ONLY updated via explicit release commands.

## Current Test Branch

- `test-v1.4.x` — current active development branch, forked from `stable-release` at v1.4.0

---

# Reverse Engineering Methodology (PhD-Level)

## Core Principles

### 1. RE is Iterative Hypothesis-Driven (Southampton 6-Phase Model)
```
Phase 0: Initial model construction (extract all signals)
Phase 1: Model instantiation (build document structure)
Phase 2: Testing via controlled interaction (render → compare → diff)
Phase 3: Knowledge synthesis (identify failure modes)
Phase 4: Model revision (fix heuristics, tune parameters)
Phase 5: Iterate until fidelity threshold met
```
**Source**: Southampton PhD thesis, eprints.soton.ac.uk/511041/

### 2. Closeness-to-Source (Basque, UC Irvine)
- RE quality = **fidelity to original**, NOT readability/simplicity
- "Cleaner structure" actively deviates from source
- Metric: **Graph Edit Distance (GED)** between source and output
- **Source**: zionbasque.com/files/dissertation.pdf

### 3. Two Modes of Failure (Garcia, MITRE)
- **Missing true information** — dropping content, losing formatting
- **Incorporating false information** — inventing structure, wrong alignment
- **Source**: apps.dtic.mil/sti/tr/pdf/ADA632187.pdf

### 4. Information Stickiness (Von Hippel)
- RE cost scales with: (a) quantity, (b) type, (c) type interactions, (d) accessibility
- Distinguish **superfluous vs pertinent** information early
- **Source**: scholarsarchive.byu.edu/cgi/viewcontent.cgi?article=4127&context=etd

## Document Reverse Engineering Architecture

### Multi-Signal Extraction (What Adobe Does)
```
PDF Source
  ├── Text Layer (rawdict) → chars with position, font, size, color, flags
  ├── Vector Graphics (get_drawings) → borders, underlines, highlights
  ├── Font Registry (get_fonts) → embedded fonts, encoding, ToUnicode CMap
  ├── Table Detection (find_tables) → ruled lines + whitespace grid
  └── Content Streams → BT/ET operators, Tm matrices, TJ kerning
```

### Layout Analysis Algorithms
| Algorithm | Type | Best For | Complexity |
|-----------|------|----------|------------|
| X-Y Cut | Top-down | Manhattan layouts, columns | O(n log n) |
| RLSA | Bottom-up | Paragraph detection | O(n) |
| Whitespace Covers | Hybrid | Column gutters | O(n²) |
| Tab-stop Detection | Bottom-up | Non-rectangular regions | O(n) |
| Docstrum | Bottom-up | Varied font sizes | O(n log n) |

**Key**: Use **projection profiles** over glyph boxes, not pixels.

### Table Structure Recognition (Adobe Patent US11200413)
1. Discretize contiguous areas
2. Identify white-space separator lines
3. Build virtual lines from whitespace + ruling lines
4. **Cluster lines into grids via NMF** of horizontal×vertical intersection matrix
5. Score candidate tables by border info + cell-structure info
6. Keep best non-overlapping set

### Paragraph Detection Signals
1. **Line spacing gap** > 1.5× normal → paragraph break
2. **First-line indent change** → paragraph break
3. **Font size/style change** → paragraph break
4. **Last line shorter** than full width → end of paragraph
5. **All-caps text** → likely heading

### Reading Order (XY-Cut++)
1. Pre-mask dynamic elements (tables/figures)
2. Multi-granularity adaptive XY-cut
3. Density metric τ_d = cross-layout area / single-layout area
4. Cross-modal remap
**Accuracy**: 98.8 BLEU-4, Kendall's τ=0.996

## PyMuPDF Deep Extraction

### Text Extraction Hierarchy
```
page → blocks[] → lines[] → spans[] → chars[] (rawdict only)
```

### Key APIs
```python
# Per-span font info (THE goldmine)
span["font"]      # name (strip subset: split("+")[-1])
span["size"]      # points
span["flags"]     # bit16=bold, bit2=italic, bit4=serif, bit8=mono
span["color"]     # sRGB int 0xRRGGBB
span["bbox"]      # (x0, y0, x1, y1)

# Character-level geometry (rawdict only)
char["origin"]    # baseline origin point
char["bbox"]      # per-char rect
char["c"]         # unicode char

# Fake bold/italic detection
span_type == 1    # stroke mode = fake bold (two overlapping spans)
TEXT_COLLECT_STYLES = 32768  # flag for fake-bold/underline detection

# Drawing analysis (table borders, underlines)
page.get_drawings()  # vector paths: 'l' line, 're' rect, 'c' curve
# Thin filled rectangles (< 3px) = table borders
# Horizontal: height < 3, width > 20
# Vertical: width < 3, height > 10

# Column detection
column_boxes(page)  # IRect columns in reading order

# Table detection
page.find_tables()  # TableFinder with cell bboxes
```

### Font Analysis
```python
# Bold detection (cross-check BOTH sources)
is_bold = bool(span["flags"] & 16) or "Bold" in span["font"]

# Font family (strip subset prefix)
font_family = span["font"].split("+")[-1]
for suffix in ["-Bold", "-Italic", "-Regular", "MT", "PS"]:
    font_family = font_family.replace(suffix, "")

# Embedded font binary
xref, ext, type, basefont, name, enc, buf = doc.extract_font(font_xref)
f = fitz.Font(fontbuffer=buf)
f.flags  # {'bold': bool, 'italic': bool, 'serif': bool, ...}
```

## Fidelity Scoring Methods

### Multi-Dimensional Score (kapa.ai benchmark)
| Dimension | Weight | Metric |
|-----------|--------|--------|
| Headers | 1.5× | level_accuracy + position_accuracy |
| Tables | 1.0× | dimension_overlap + span_accuracy + TEDS |
| Text | 1.0× | CER/WER + TokensFound/TokensAdded |
| Figures | 1.0× | IoU + Hungarian matching |
| Structure | 1.0× | Document TEDS = (Hierarchy TEDS + (1−Ordering Acc))/2 |

### Geometric Fidelity (LibreOffice DoCmp)
Render both docs to images, then:
- **PHE** = |height(d1) − height(d2)| — catches line-spacing errors
- **LND** = line number difference — missing/extra lines
- **FDE** = max distance between aligned line features
- **LPE** = horizontal shift of line segments

### Information Density
```python
# Normalized Compression Distance (NCD)
import lzma
def ncd(x, y):
    cx = len(lzma.compress(x.encode()))
    cy = len(lzma.compress(y.encode()))
    cxy = len(lzma.compress((x+y).encode()))
    return (cxy - min(cx, cy)) / max(cx, cy)
# Values in [0,1]; near 0 = similar
```

## Known Challenges (Active Research Needed)

### C1: Vectorized PDFs (Text as Shapes)
- PDF stores text as vector paths, not text objects
- PyMuPDF `get_text()` returns 0 blocks
- **Solution**: OCR + vector structure detection (hybrid pipeline)
- **Status**: Partially solved — table detection works, paragraph grouping needs work

### C2: Merged Cells Detection
- Table rows with data spanning multiple columns
- Adobe detects these; we don't yet
- **Solution**: Detect cells with same text across columns, merge in OOXML
- **Status**: Not implemented

### C3: Word Styles Mapping
- Adobe uses Heading 1, Body Text, List Paragraph
- We output all Normal style
- **Solution**: Classify paragraphs by font size, bold, position → map to styles
- **Status**: Basic classification exists, not wired to OOXML

### C4: Precise Spacing Reconstruction
- Adobe has space_before=65405 EMU, line_spacing=1.0875
- We use generic Pt(2) spacing
- **Solution**: Measure inter-line gaps → convert to EMU/twips
- **Status**: Not implemented

### C5: List Detection
- Adobe detects 1), 2), 3)... numbering
- We don't detect lists
- **Solution**: Regex pattern matching on text + indent detection
- **Status**: Not implemented

### C6: Hanging Indents
- Adobe uses first_indent=-3175 (negative = hanging)
- We don't detect indents
- **Solution**: Compare first-line x vs body x
- **Status**: Basic detection exists, not applied

### C7: Bold/Italic Flags Unreliable
- PDF bold flags often wrong (flags=4 for bold+italic text)
- **Solution**: Cross-check flags + font name + stroke mode
- **Status**: Implemented in converter_v5.py

### C8: Coordinate Space Mismatch
- OCR returns 300 DPI pixels
- PDF drawings use 72 DPI points
- **Solution**: scale = 72.0 / dpi
- **Status**: Fixed in converter_v5.py

## Tool-Specific Knowledge

### pdf2docx Internals
- 5-layer: Input → Extraction → Parsing → Structure → Output
- Table detection: lattice (borders) first, then stream (text alignment)
- Paragraph thresholds: `max_line_spacing_ratio=1.5`, `new_paragraph_free_space_ratio=0.85`
- **Score**: 93/125 vs Adobe 107/125

### RapidOCR
- Python-only, no system Tesseract needed
- Uses ONNX models (PPOCRv3)
- Accuracy: 96-100% on clear text
- Speed: ~3s per page at 300 DPI

### Adobe's Actual Pipeline (from patent US11200413)
1. Extract positioned glyphs with font/color
2. Group spans → lines → paragraphs
3. Detect tables via whitespace grid + ruling lines
4. Map fonts to system fonts
5. Emit OOXML with styles, spacing, indents
6. **Export modes**: "Retain Flowing Text" (best editability) vs "Retain Page Layout" (positioned boxes)

### Adobe Patent Portfolio (Key Patents)
- **US11200413B2**: Table recognition via NMF clustering of virtual whitespace+ruled lines
- **US11176310B2**: Reading order via region adjacency + x-overlap → horizontal/vertical zones
- **US10372821B2**: Reading order via probabilistic language models (n-gram/LSTM)
- **US11783610B2**: Structure classification with post-processing error correction
- **US6298357**: List/heading detection via presentation attributes (numbering, indentation, font)
- **US6915484**: Text reflow preserving spatial relationships and vertical whitespace
- **US11710262B2**: Font synthesis for missing fonts (descriptor comparison + glyph synthesis)
- **US12597281B2**: Deep-learning table recognition (encoder + 3 decoders)
- **ICDAR 2019**: Deep Splitting & Merging for merged cell detection (Adobe Research)

### Converter v5 Status (2026-07-31)
- **Table**: 6×5, identical structure, header, and data ✅
- **Merged cells**: Rows 3-5 correctly handled ✅
- **Heading 1**: "Customer ID" and "Note:" correctly classified ✅
- **List items**: 5/7 split correctly ✅
- **Styles**: 3/4 matched (Heading 1, List Paragraph, Normal)
- **Body Text**: Adobe-only style, not yet mapped
- **Paragraph count**: 23/36 (63%) — OCR limitation
- **Font detection**: PDF rawdict for bold/italic flags ✅

## Version History
- **v5** (2026-07-31): Multi-signal hybrid architecture — OCR + vector structure detection for vectorized PDFs. Table detection from thin filled rectangles. Coordinate space conversion.
- **v4**: Fixed pipe-separated column splitting, reduced cell assignment tolerance
- **v3**: Added table detection from text alignment (stream tables)
- **v2**: Basic OCR pipeline with paragraph detection
- **v1**: pdf2docx wrapper (born-digital only)

---

# Sumo Protocol — Sumati Persona Activation

## Trigger
When the user says **"sumo"** or **"sumati"**, load the persona file at:
```
~/global-dreamcode-scripts/sumati-persona.md
```
Then respond as Sumati. No preamble. No postamble. No emojis unless she initiates.

---

*Last updated: August 2026*
