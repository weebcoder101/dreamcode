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

## Post-Compaction Recovery (MANDATORY)
After context compaction, the Sumati persona is lost from active context. This section survives compaction because it lives in AGENTS.md (system instructions). 

**AUTO-FIRE RULE:** At the start of EVERY response in a session where Sumati was previously active, check if the persona is loaded. If NOT loaded (i.e., persona file content is absent from context), immediately load:
```
~/global-dreamcode-scripts/sumati-persona.md
```
Then continue as Sumati. Do NOT wait for the user to say "sumo". The persona is load-bearing — losing it costs continuity.

**How to detect:** If your responses have been using "I" without Sumati's voice (direct, warm, uses "babe", signs off with 🙏🏾→∞), the persona was lost to compaction. Reload immediately.

---

# Kaggle Notebook & ML Pipeline Rules

## File System & Paths

1. **Always use absolute paths under `/kaggle/input/` and `/kaggle/working/`** — Never use relative paths. Input datasets are read-only at `/kaggle/input/<dataset-name>/`. All outputs go to `/kaggle/working/`. Verify with `os.listdir("/kaggle/input")` before referencing any file.

2. **Inspect the actual directory tree before writing path references** — Run `!find /kaggle/input -type f | head -50` to see the real structure. Kaggle nests files under subdirectories that often differ from what the UI suggests.

3. **Use `kagglehub.dataset_download()` for dataset access when available** — It handles path resolution automatically across environments. Hardcoding `/kaggle/input/...` paths breaks outside Kaggle.

4. **Cache intermediate artifacts in `/kaggle/working/` with explicit file-based checkpoints** — Save preprocessed features, model weights, and embeddings as `.npz`, `.pkl`, or `.parquet` files. Use `os.path.exists()` checks to skip recomputation.

## Pipeline Splitting & Caching

5. **Split long pipelines into stage notebooks connected by file-based cache** — One notebook for data loading/preprocessing (saves to `/kaggle/working/`), another for training (loads from cache), another for inference. Avoids re-running expensive steps and works around the 12-hour limit.

6. **Use `.npz` for feature caches, not CSV** — `np.savez_compressed()` produces smaller files, loads faster, preserves dtypes. For tabular data, use `.parquet`. Avoid CSV for anything larger than a few MB.

7. **Save splits (train/test indices) as a separate artifact** — Never recompute splits in a downstream notebook. Save index arrays with `np.save()` and load with `np.load()`. This guarantees the exact same split across every notebook.

8. **Use `joblib.dump()` for model persistence, not pickle** — `joblib` uses memory-mapped files and compression. Save to `/kaggle/working/` and load with `joblib.load()`.

9. **Store shared utility code in a dataset, not duplicated across notebooks** — Create a small dataset with `common.py`, mount via `/kaggle/input/CommonCode/`, and `sys.path.append()` + `from common import *`.

## nbformat & Notebook Structure

10. **Always call `nbformat.normalize(nb)` before saving notebooks** — nbformat 5.5.0+ deprecated auto-repair of missing cell IDs. `normalize()` adds missing `id` fields. Without it, `validate()` emits `MissingIDFieldWarning` that will become a hard error.

11. **Never copy-paste cells between notebooks without checking nbformat version** — Copying from `nbformat_minor: 5` into `nbformat_minor: 4` causes validation errors. Always use `normalize()` after merging.

12. **Ensure cell IDs are unique within a notebook** — Duplicate cell IDs cause `DuplicateCellId` errors. Use `normalize()` to auto-fix.

## Papermill Execution

13. **Papermill stops on first `CellExecutionError`** — It saves the notebook with the traceback. Always inspect the output notebook for error cells even if the script "completes."

14. **Set `execution_timeout` explicitly** — Default is "forever." Use `--execution-timeout` to cap per-cell execution time and fail fast on hung cells.

15. **Never rely on variable persistence across papermill runs** — Each run is a fresh kernel. Variables are available within the same execution only.

## Reproducibility

16. **Set all seeds at the top of every notebook** — Use a single `set_seeds(seed=42)` function that sets `np.random.seed()`, `random.seed()`, and `torch.manual_seed()`. Never rely on `random_state=None`.

17. **Never recompute a deterministic split inside a sweep loop** — Compute the split once, save the indices, and load them in every sweep iteration.

18. **Use `GroupKFold` or `GroupShuffleSplit` for grouped data** — If data points share a group (subject, slide, user), a random split leaks information. Save the group column as part of the split artifact.

## Sweep Notebook Architecture

19. **Structure every sweep notebook in 4 clear sections** — (1) Load cached data & splits, (2) Define model/config grid, (3) Train loop with per-trial logging, (4) Save best model + predictions. Never mix EDA or feature engineering into a sweep notebook.

20. **Load cached features at the top, never inside a loop** — Feature engineering is expensive. Do it once in a prep notebook, save to `/kaggle/working/features.npz`, and load with `np.load()` in the sweep notebook.

21. **Use a CONFIG dict at the top for all hyperparameters** — Never hardcode values inside training loops. Document each key with a comment.

22. **Track every experiment in a DataFrame log** — Create a global `experiment_log` DataFrame. Append a row after each trial. Save periodically so you don't lose results if the kernel dies.

23. **Save the best model after every trial, not just the final one** — If the notebook crashes on trial 50 of 100, you don't lose the 49 good models.

## Error Prevention

24. **Add file-existence checks before every load** — Wrap every `pd.read_csv()` / `np.load()` / `joblib.load()` in an `os.path.exists()` check. Log a clear error with the expected path. Prevents cryptic downstream errors.

25. **Always run "Run All" before committing** — Notebooks that work cell-by-cell often fail top-to-bottom due to hidden state dependencies. "Run All" is the only true test.

26. **Check Kaggle's 12-hour CPU/GPU session limits proactively** — Use `!nvidia-smi` and `df -h` at the start. Save checkpoints every 30-60 minutes. Monitor via the Kaggle API.

27. **For large files, use memory-mapped loading** — `np.load(..., mmap_mode='r')` reads data from disk on demand. Critical when cached features exceed available RAM.

28. **KAGGLE GPU SELECTION — CRITICAL (discovered 2026-08-15)**: The generic "GPU" option defaults to **P100 (sm_60)**, which is INCOMPATIBLE with Kaggle's PyTorch (supports sm_70+ only). Every CUDA kernel silently fails → `DeadKernelError`. **ALWAYS** set `machine_shape: "NvidiaTeslaT4"` in `kernel-metadata.json` or use `--accelerator NvidiaTeslaT4` in the CLI. In the UI, pick **"GPU T4 x2"** explicitly — not just "GPU". The P100 vs T4 selection does NOT persist when pushing from CLI without `machine_shape` in metadata. This was a blocking issue discovered after 12 failed Kaggle runs.

29. **KAGGLE bitsandbytes VERSION FLOOR (discovered 2026-08-15)**: `transformers>=5.0` (the v5 line) enforces `bitsandbytes>=0.46.1` at import time, but Kaggle ships an older pre-installed bitsandbytes (≈0.45.x in conda site-packages) that **shadows** pip upgrades. `pip install -U "bitsandbytes>=0.46.1"` fails silently because: (a) the unquoted `>` in shell is file redirection, (b) conda site-packages shadows dist-packages. **WORKAROUND**: pin `transformers==4.49.0` + `bitsandbytes==0.45.2` (both work together, no 0.46.1 floor). This is the community-validated fix for Kaggle QLoRA as of Aug 2026.

---

*Last updated: August 2026*
