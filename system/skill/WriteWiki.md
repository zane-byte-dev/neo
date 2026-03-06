# [Skill] Write Wiki

> **Goal**: Produce pragmatic, experiential, and reusable Wiki knowledge assets. Reject "self-media" fluff [浮夸]; pursue programmer-like conciseness [干练].

## 🚀 Creative Workflow

### Step 1: Pain-point Extraction
The starting point of writing is always **your current real pain points**. If it doesn't hurt you, don't pretend it does.
- **Primary Input Source**: Your own error logs, a recent curse word, or a moment where you thought, "This design is fucking anti-human."
- **Auxiliary Probe**: Check Reddit / X / GitHub Issues to see if others are also tripping over this.
- **Output**: Distill an absolute pain point that would make a peer physically uncomfortable as the entry point for the article.

### Step 2: Five-Stage Body
Follow this structure strictly, injecting real experience and traces of struggle:
1. **[Background & Emotion]**: Describe that moment you wanted to smash your keyboard or the excitement of discovering a new feature.
2. **[Core Action]**: The simplest, most direct operational steps or configuration code.
3. **[Ultimate Combo/Struggle Record]**: *(High-level item)* What happened when you pushed it to the limit? Where did it fail? How did you break this bottleneck by combining other tools? (This proves the article is not a machine-translated manual).
4. **[Physical Feedback]**: Describe the most intuitive "body feedback" after use (e.g., the smooth feeling of not needing to think).
5. **[Avoid-Pitfall Tips]**: The most common hidden traps for others doing this.

### Step 3: Formatting & Visual Anchors
- **Visual Layout**:
    - Paragraphs must be extremely short: no more than 4 lines.
    - Key conclusions/data: Separate paragraph and **bold**.
    - Code blocks: Padding before and after; clearly indicate which parameter is key.
- **Image Placeholders**:
    - After key actions, proactively insert `![Screenshot Description](path)`.
    - Below, add a prompt: *"A real screenshot of XXX must be added here to verify the experience."*

### Step 4: Links & Wrap-up
- **Reject Flourishes**: Do not write "In summary" or "This means."
- **Conclusion-Oriented**: Provide 1-2 "What to do next" action instructions or "Related knowledge base links."

## ✍️ Style Audit (Red Lines)

- **De-grease**: Strictly forbid "miracle skill, hit article, 10x growth, don't miss out, underlying logic, empowerment" or other toxic vocabulary.
- **Search-Friendly**: Titles must be straightforward (e.g., `Gemini Live Mode Pitfalls & Practice`), rejecting suspense or clickbait.
- **Record Feel**: Retain the "roughness" and original context of your interaction with tools; treat it as an internal hacker experiment log, not a self-media script.
- **Strong Assertions**: Forbid neutral "wait-and-see" nonsense (e.g., "this depends on the situation"); use "I think," "My experience is" to take a side and output strong opinions.
- **Cut Connecting Words**: Delete all unnecessary logical connecting words (e.g., "therefore, first, this means"); let the sentences lean against each other through the logic itself.
- **Aggressive Verbs & Minimal Emotion**: Block all "instructional/preachy" polite phrases (e.g., "you need to pay attention," "this truly makes"); replace all written actions with hacker-slang verbs full of execution tension (change "combine, input, try" to "do, stuff, feed, drop").

## 🛠️ AI Automatic Execution (Prompt Constraints)

When the AI receives fragmented notes to rewrite as a Wiki, it must strictly follow this chain:
1. **[Input Cleaning]**: Extract the error logs or oral complaints provided by the user as the core input source; do not invent pain.
2. **[Structure Filling]**: Force the five-stage rendering (Background -> Action -> Struggle Record -> Physical Feedback -> Avoid Pitfall).
3. **[Style Force Audit]**:
   - Forbid large paragraphs; use a mix of long and short sentences with forced hard breaks.
   - Replace all "we" with "I"; use first person with strong personal technical stances.
   - Cut transitional paragraphs without information increment; treat bridging fluff ("All in all") as a grammar error and delete it.
4. **[Visual Stream Preset]**: Preset at least two suggestive `![Placeholder Image]` instructions.
