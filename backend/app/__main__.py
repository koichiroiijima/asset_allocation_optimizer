"""`python -m app` で CLI を起動するためのエントリポイント。"""

from app.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
