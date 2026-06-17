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
document$.subscribe(() => {
  MathJax.startup.output.clearCache();
  MathJax.typesetClear();
  MathJax.texReset();
  MathJax.typesetPromise();
});
