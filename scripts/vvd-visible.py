#!/usr/bin/env python3
"""Exit 0 if no viewable top-level window overlaps the VVD window, 1 otherwise.

scripts/vvd.sh grabs the screen region under the VVD window (its GL surface can't be read
directly), so anything stacked above it would end up in the screenshot.
"""
import subprocess
import sys

from Xlib import X, display

info = subprocess.run(["xwininfo", "-name", "Vega Virtual Device"], capture_output=True, text=True).stdout
wid = int(info.split("Window id: ")[1].split()[0], 16)
vals = {k: int(line.split(":")[1]) for line in info.splitlines() for k in ("Absolute upper-left X", "Absolute upper-left Y", "Width", "Height") if line.strip().startswith(k)}
vx, vy, vw, vh = vals["Absolute upper-left X"], vals["Absolute upper-left Y"], vals["Width"], vals["Height"]

d = display.Display()
root = d.screen().root
top = d.create_resource_object("window", wid)
while top.query_tree().parent.id != root.id:
    top = top.query_tree().parent
kids = root.query_tree().children
for k in kids[[c.id for c in kids].index(top.id) + 1:]:
    try:
        if k.get_attributes().map_state != X.IsViewable:
            continue
        g = k.get_geometry()
        t = k.translate_coords(root, 0, 0)
        x, y = -t.x, -t.y
        if g.width > 50 and g.height > 50 and x < vx + vw and x + g.width > vx and y < vy + vh and y + g.height > vy:
            sys.exit(1)
    except Exception:
        continue
sys.exit(0)
