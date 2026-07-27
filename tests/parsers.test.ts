import assert from "node:assert/strict";
import test from "node:test";
import { parseDxf } from "../src/lib/dxf";
import { parseGCode } from "../src/lib/gcode";
import { getBounds } from "../src/lib/geometry";

test("parst G-Code in absoluten und relativen Koordinaten", () => {
  const result = parseGCode("G21 G90\nG0 X10 Y10\nG1 X20 Y10\nG91\nG1 X5 Y-5");
  assert.equal(result.paths.length, 3);
  assert.deepEqual(result.paths.at(-1)?.points.at(-1), { x: 25, y: 5 });
  assert.equal(result.paths[0].rapid, true);
  assert.equal(result.paths[1].rapid, false);
});

test("wandelt Inch-G-Code in Millimeter um und approximiert Vollkreise", () => {
  const result = parseGCode("G20 G90\nG0 X1 Y0\nG2 I-1 J0");
  const bounds = getBounds(result.paths);
  assert.ok(result.paths[1].points.length > 50);
  assert.ok(bounds && Math.abs(bounds.maxX - bounds.minX - 50.8) < 0.01);
});

test("parst DXF-Linien, Kreise und LWPOLYLINE", () => {
  const dxf = `0
SECTION
2
ENTITIES
0
LINE
10
0
20
0
11
20
21
0
0
CIRCLE
10
10
20
10
40
5
0
LWPOLYLINE
70
1
10
0
20
0
10
10
20
0
10
10
20
10
0
ENDSEC
0
EOF`;
  const result = parseDxf(dxf);
  assert.equal(result.entityCount, 3);
  assert.equal(result.paths[2].closed, true);
  assert.ok(result.paths[1].points.length > 50);
});

test("berücksichtigt DXF-Einheiten aus INSUNITS", () => {
  const dxf = `0
SECTION
2
HEADER
9
$INSUNITS
70
1
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
10
0
20
0
11
1
21
0
0
ENDSEC
0
EOF`;
  const result = parseDxf(dxf);
  assert.equal(result.paths[0].points[1].x, 25.4);
});
