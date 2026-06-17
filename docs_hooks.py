"""mkdocs hook: sync notebooks/markdown from the repo root into docs/.

Runs on every build (including `mkdocs serve` live-reload) so the served
docs always reflect the source notebooks in the root directory rather than
stale copies committed under docs/.
"""

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
            shutil.copy2(src_path, DOCS / dst)
