#!/usr/bin/env python
# MyTasker — Django entry point.
# Written and maintained by drogoz · https://github.com/deepdrogo/mytasker

import os
import sys


def main() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
