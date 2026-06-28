window.MathJax = {
  tex: {
    inlineMath: [["\\(", "\\)"], ["$", "$"]],
    displayMath: [["\\[", "\\]"], ["$$", "$$"]],
    processEscapes: true,
    processEnvironments: true
  },
  options: {
    // Skip code/script/style; let MathJax scan everything else on the page.
    // mkdocs-jupyter emits raw "$...$" without the pymdownx "arithmatex" class,
    // so we must NOT restrict typesetting to that class.
    skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"]
  }
};

// Re-typeset on Material's instant navigation.
function ztmTypesetMath() {
  if (!window.MathJax || !MathJax.startup || !MathJax.typesetPromise) return;
  MathJax.startup.promise.then(() => {
    if (MathJax.startup.output) MathJax.startup.output.clearCache();
    if (MathJax.typesetClear) MathJax.typesetClear();
    if (MathJax.texReset) MathJax.texReset();
    return MathJax.typesetPromise();
  }).catch(error => console.warn("[mathjax] typeset failed", error));
}

if (window.document$ && typeof document$.subscribe === "function") {
  document$.subscribe(() => setTimeout(ztmTypesetMath, 0));
} else {
  document.addEventListener("DOMContentLoaded", ztmTypesetMath);
}
