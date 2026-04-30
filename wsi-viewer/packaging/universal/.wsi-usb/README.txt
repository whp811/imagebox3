This **.wsi-usb** folder is the only large “engine” area on the drive. It is meant to be **out of the way** after a successful start:

- **Windows:** the root `WSI-Hive-Windows.bat` marks this folder and its contents **hidden in Explorer** (`attrib`) on success.
- **macOS:** the root `WSI-Hive-macOS.command` flow marks this folder **hidden in Finder** (`chflags`) on success, if the volume supports it.

Inside here you will find the **per-OS** payloads:

- `win\` — portable .exe
- `mac\` — `WSI Hive.app` (or similar)
- `linux\` — `.AppImage` (or similar)
- The small scripts `launch-*.cmd` and `launch-*.sh` that the three root starters run.

The visible entry points at the **parent** of this folder are only **WSI-Hive-Windows.bat**, **WSI-Hive-macOS.command**, **WSI-Hive-Linux.sh**, the **Slides** folder, and any README you ship.

You do not need to open things here in normal use.
