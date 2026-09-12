"""CLI entry point for preparing the background-removal model cache."""

import logging

from untitled_jam.background_removal import preload_model


def main() -> None:
    """Download, verify, and load the configured model."""

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    preload_model()


if __name__ == "__main__":
    main()
