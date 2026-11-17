# Simple Gridfinity Generator

A fast, zero-dependency static web app for generating printable Gridfinity baseplate tiles sized to any drawer and 3D printer bed.

## Features

- **Drawer sizing in `mm`, `cm`, or `in`** with configurable fit clearance
- **Searchable IKEA drawer presets** (`ALEX`, `TROTTEN`, `MAXIMERA`, `SEKTION`, `PAX / KOMPLEMENT`, `HELMER`, `MALM`, `NORDLI`, `HEMNES`, `KALLAX`, and more) with interior floor dimensions and curved corner defaults where applicable
- **Bambu Lab printer presets** (`A1 mini`, `A1`, `P1P / P1S`, `X1C / X1E`, `H2D Single`, `H2D Dual`) plus **Custom** bed dimensions
- **Smart border rim padding** to center the grid and fill leftover drawer space so tiles don't slide around
- **Optimal balanced tiling** that minimizes print plates, groups identical tiles (including 90°/180°/270° rotations), and avoids tiny strips
- **Three baseplate profiles**:
  - **Fast Lightweight (4.25 mm)**: Flat bottom, blunted 0.40 mm top lip, and hollow 45° divider channels for minimum filament and fast printing
  - **Standard Open Frame (4.65 mm)**: Classic Zack Freedman Gridfinity profile
  - **Standard Solid Floor (5.85 mm)**: Adds a 1.2 mm solid bottom sheet
- **Interactive 2D Assembly Map & WebGL2 3D Preview** (full drawer view + per-model print bed view)
- **Instant Bambu Studio `.3MF` & `.STL`/`.ZIP` export**: One-click multi-plate `.3mf` with every required copy pre-arranged on Plates `1..N`, or individual Binary `.stl` files + `ASSEMBLY_GUIDE.txt` in a `.zip`
