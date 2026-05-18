"""Hermes Forge Python startup safety hooks for Windows.

Python automatically imports ``sitecustomize`` when this directory is present
on PYTHONPATH. Keep this module dependency-free and tiny: it runs before Hermes
or gateway code and protects text-mode subprocess readers from Windows child
processes that still emit GBK/ANSI bytes.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading


if os.name == "nt" and os.environ.get("HERMES_FORGE_DISABLE_SUBPROCESS_TEXT_SAFETY") != "1":
    _original_popen_init = subprocess.Popen.__init__

    def _patched_popen_init(self, *args, **kwargs):
        has_text = bool(kwargs.get("text") or kwargs.get("universal_newlines"))
        # universal_newlines is the 9th positional Popen argument.
        if not has_text and len(args) > 8 and args[8]:
            has_text = True
        if (has_text or "encoding" in kwargs) and "errors" not in kwargs:
            kwargs = dict(kwargs)
            kwargs["errors"] = "replace"
        return _original_popen_init(self, *args, **kwargs)

    subprocess.Popen.__init__ = _patched_popen_init

    _original_thread_excepthook = threading.excepthook

    def _patched_thread_excepthook(args):
        if (
            args.exc_type is UnicodeDecodeError
            and args.thread.name == "_readerthread"
            and "utf-8" in str(args.exc_value)
        ):
            print(
                "Warning: subprocess reader thread dropped undecodable output "
                f"({args.exc_value}).",
                file=sys.stderr,
                flush=True,
            )
            return
        _original_thread_excepthook(args)

    threading.excepthook = _patched_thread_excepthook
