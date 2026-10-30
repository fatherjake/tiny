# Prototype

A throwaway sketch to settle a design or behaviour question by observing it, instead of asking the human or guessing.

1. **State the fork.** Write the question and the two or three candidates in a line each, and what you will look at to decide (output, timing, layout, size, a failing case).
2. **Build each candidate** as small as possible, on its own branch or in a scratch folder. Do not touch the main code path. No tests, no polish.
3. **Run them side by side** on the same input. Capture what you observed: the output, a screenshot, a measurement. Label each fact as measured, not inferred.
4. **Pick one** and say why, using the evidence. If the evidence does not separate them, say so and choose the simpler one. If it truly comes down to taste, hand the human the options and your recommendation.
5. **Keep the evidence** (branch name, commit SHA, screenshots) and throw away the sketch code. Implementation starts fresh under `playbooks/feature.md`.

**Reply:** the question, the options tried, what each showed, the pick and why, and where the evidence is.
