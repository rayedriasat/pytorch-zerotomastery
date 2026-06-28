"""mkdocs hook: sync notebooks/markdown from the repo root into docs/.

Runs on every build (including `mkdocs serve` live-reload) so the served
docs always reflect the source notebooks in the root directory rather than
stale copies committed under docs/.
"""

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
DOCS = ROOT / "docs"

# (source path relative to repo root, destination filename in docs/)
FILES = [
    *[(p, p.name) for p in sorted(ROOT.glob("*.ipynb"))],
    ("05_pytorch_going_modular.md", "05_pytorch_going_modular.md"),
    ("extras/pytorch_2_intro.ipynb", "pytorch_2_intro.ipynb"),
    ("extras/pytorch_extra_resources.md", "pytorch_extra_resources.md"),
    ("extras/pytorch_cheatsheet.ipynb", "pytorch_cheatsheet.ipynb"),
    ("extras/pytorch_most_common_errors.ipynb", "pytorch_most_common_errors.ipynb"),
]


def on_startup(command, dirty, **kwargs):
    DOCS.mkdir(exist_ok=True)
    for src, dst in FILES:
        src_path = ROOT / src
        if src_path.exists():
            dst_path = DOCS / dst
            shutil.copy2(src_path, dst_path)
            if dst_path.suffix == ".ipynb":
                _sanitize_notebook(dst_path)


def on_page_content(html, page, config, files, **kwargs):
    """Remove notebook runtime artifacts that do not belong on static pages.

    mkdocs-jupyter can emit `MathJax.Hub.Config` scripts for notebook output.
    The site loads MathJax v3 globally, so those scripts throw during Material's
    instant navigation and can interrupt page hydration. Colab dataframe output
    also emits scripts that require `google.colab`, and demo iframes can 404 or
    be blocked by remote X-Frame-Options. Keep the rendered/static content and
    remove only the runtime-only parts.
    """
    return _clean_static_html(html)


def _sanitize_notebook(path):
    """Strip browser-only Colab/demo output before mkdocs-jupyter caches it."""
    try:
        notebook = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return

    changed = False
    for cell in notebook.get("cells", []):
        for output in cell.get("outputs", []):
            data = output.get("data")
            if not isinstance(data, dict):
                continue

            if "application/vnd.google.colaboratory.intrinsic+json" in data:
                del data["application/vnd.google.colaboratory.intrinsic+json"]
                changed = True

            html = data.get("text/html")
            if html is None:
                continue
            if isinstance(html, list):
                original = "".join(html)
                cleaned = _clean_static_html(original)
                if cleaned != original:
                    data["text/html"] = cleaned.splitlines(keepends=True)
                    changed = True
            elif isinstance(html, str):
                cleaned = _clean_static_html(html)
                if cleaned != html:
                    data["text/html"] = cleaned
                    changed = True

    if changed:
        path.write_text(json.dumps(notebook, ensure_ascii=False, indent=1), encoding="utf-8")


def _clean_static_html(html):
    html = re.sub(
        r"\s*<!-- Load mathjax -->\s*<script src=\"\">\s*</script>\s*"
        r"<!-- MathJax configuration -->\s*"
        r"<script type=\"text/x-mathjax-config\">[\s\S]*?MathJax\.Hub[\s\S]*?</script>\s*"
        r"<!-- End of mathjax configuration -->",
        "",
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r"\s*<script\b[^>]*>[\s\S]*?(?:google\.colab|convertToInteractive|buttonEl|renderOutput)[\s\S]*?</script>",
        "",
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r"\s*<style\b[^>]*>[\s\S]*?\.colab-df-(?:convert|container)[\s\S]*?</style>",
        "",
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r"\s*<button\b[^>]*\bcolab-df-convert\b[^>]*>[\s\S]*?</button>",
        "",
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r'<iframe([^>]+src=["\']https://(?:[^"\']*?gradio\.app|hf\.space/embed/[^"\']+|huggingface\.co/[^"\']+|[^"\']+\.hf\.space/[^"\']*)["\'][^>]*)>\s*</iframe>',
        _replace_external_demo_iframe,
        html,
        flags=re.IGNORECASE,
    )
    return html


def _replace_external_demo_iframe(match):
    attrs = match.group(1)
    src_match = re.search(r'src=["\']([^"\']+)["\']', attrs, flags=re.IGNORECASE)
    if not src_match:
        return ""
    src = src_match.group(1)
    return (
        '<p class="ztm-iframe-fallback">'
        f'<a href="{src}" target="_blank" rel="noopener">Open the live demo</a>'
        "</p>"
    )
