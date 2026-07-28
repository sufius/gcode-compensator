import assert from "node:assert/strict";
import test from "node:test";
import { parseDxf } from "../src/lib/dxf";
import { createPocketRoughingAndFinishing, offsetSelectedGCode, offsetSelectedGCodeNodes, offsetSelectedGCodeZ, parseGCode } from "../src/lib/gcode";
import { getBounds } from "../src/lib/geometry";
import { transformPaths, transformPoint } from "../src/lib/geometry";

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
  assert.equal(result.referencePoints.length, 4);
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
  assert.equal(result.referencePoints[1].x, 25.4);
});

test("rotiert DXF-Pfade um den ausgewählten Nullpunkt", () => {
  const origin = { x: 10, y: 5 };
  const point = transformPoint({ x: 20, y: 5 }, 90, origin);
  assert.ok(Math.abs(point.x) < 1e-10);
  assert.equal(point.y, 10);
  const paths = transformPaths([{ points: [origin, { x: 20, y: 5 }] }], 90, origin);
  assert.deepEqual(paths[0].points[0], { x: 0, y: 0 });
});

test("verschiebt eine ausgewählte G-Code-Bewegung über Start und Ende", () => {
  const source = "G21 G90\nG0 X0 Y0\nG1 X10 Y0\nG1 X10 Y10\nG1 X0 Y10\nG1 X0 Y0";
  const result = parseGCode(source);
  const modified = offsetSelectedGCode(source, result, [1], { x: 0, y: 1 });
  const parsed = parseGCode(modified);
  assert.deepEqual(parsed.paths[0].points[1], { x: 0, y: 1 });
  assert.deepEqual(parsed.paths[1].points[1], { x: 10, y: 1 });
  assert.deepEqual(parsed.paths[2].points[1], { x: 10, y: 10 });
  assert.deepEqual(parsed.paths[4].points[1], { x: 0, y: 1 });
});

test("schreibt Offsets in relativem G-Code konsistent neu", () => {
  const source = "G21 G91\nG0 X0 Y0\nG1 X10 Y0\nG1 X0 Y10";
  const result = parseGCode(source);
  const modified = offsetSelectedGCode(source, result, [1], { x: 0, y: 0.1 });
  const parsed = parseGCode(modified);
  assert.deepEqual(parsed.paths[1].points[0], { x: 0, y: 0.1 });
  assert.deepEqual(parsed.paths[1].points[1], { x: 10, y: 0.1 });
  assert.deepEqual(parsed.paths[2].points[1], { x: 10, y: 10 });
});

test("verschiebt ausschließlich ausgewählte G-Code-Knoten", () => {
  const source = "G21 G90\nG0 X0 Y0\nG1 X10 Y0\nG1 X10 Y10";
  const result = parseGCode(source);
  const modified = offsetSelectedGCodeNodes(source, result, [{ x: 10, y: 0 }], { x: 0.1, y: -0.2 });
  const parsed = parseGCode(modified);
  assert.deepEqual(parsed.paths[0].points[1], { x: 0, y: 0 });
  assert.deepEqual(parsed.paths[1].points[1], { x: 10.1, y: -0.2 });
  assert.deepEqual(parsed.paths[2].points[0], { x: 10.1, y: -0.2 });
  assert.deepEqual(parsed.paths[2].points[1], { x: 10, y: 10 });
});

test("addiert einen Z-Offset nur auf ausgewählte G-Code-Bahnen", () => {
  const source = "G21 G90\nG0 X0 Y0 Z5\nG1 X10 Y0 Z-1\nG1 X10 Y10\nG1 X0 Y10 Z-2";
  const result = parseGCode(source);
  const modified = offsetSelectedGCodeZ(source, result, [1, 2], 0.2);
  const parsed = parseGCode(modified);
  assert.equal(modified.split("\n")[2], "G1 X10 Y0 Z-0.8");
  assert.equal(modified.split("\n")[3], "G1 X10 Y10");
  assert.equal(modified.split("\n")[4], "G1 X0 Y10 Z-2");
  assert.equal(parsed.paths[0].gcode?.endZ, 5);
  assert.equal(parsed.paths[1].gcode?.endZ, -0.8);
  assert.equal(parsed.paths[2].gcode?.endZ, -0.8);
  assert.equal(parsed.paths[3].gcode?.endZ, -2);
});

test("verändert auch im relativen G-Code ausschließlich vorhandene Z-Wörter", () => {
  const source = "G21 G91\nG0 X0 Y0 Z5\nG1 X10 Y0 Z-6\nG1 X0 Y10\nG1 X-10 Y0";
  const result = parseGCode(source);
  const modified = offsetSelectedGCodeZ(source, result, [1], -0.1);
  const parsed = parseGCode(modified);
  assert.equal(modified.split("\n")[2], "G1 X10 Y0 Z-6.1");
  assert.equal(modified.split("\n")[3], "G1 X0 Y10");
  assert.ok(Math.abs((parsed.paths[1].gcode?.endZ ?? 0) + 1.1) < 1e-9);
  assert.ok(Math.abs((parsed.paths[2].gcode?.endZ ?? 0) + 1.1) < 1e-9);
  assert.ok(Math.abs((parsed.paths[3].gcode?.endZ ?? 0) + 1.1) < 1e-9);
});

test("ignoriert eine Auswahl vollständig, wenn die Bahn kein explizites Z enthält", () => {
  const source = "G21 G90\nG1 X0 Y0 Z-1\nG1 X10 Y0";
  const result = parseGCode(source);
  assert.equal(offsetSelectedGCodeZ(source, result, [1], 0.5), source);
});

test("erzeugt vollständige Schrupp- und Schlichtdurchgänge mit symmetrischer Zugabe", () => {
  const source = `G21 G90
G0 X0 Y0
G0 Z0.5
G1 Z-6.8 F200
G1 Y96.9 F400
G1 X46.5
G1 Y0
G1 X0
G1 Y96.9
G0 Z5
; andere Operation
G0 X100 Y100
G1 Z-2 F300`;
  const parsed = parseGCode(source);
  const pocketIndices = parsed.paths
    .map((path, index) => ({ path, index }))
    .filter(({ path }) => !path.rapid && path.gcode && path.gcode.lineIndex <= 8)
    .map(({ index }) => index);
  const generated = createPocketRoughingAndFinishing(source, parsed, pocketIndices, {
    allowanceX: 0.1,
    allowanceY: 0.1,
    allowanceZ: 0.1,
    roughingFeed: 1200,
    finishingFeed: 600,
  });

  assert.ok(Math.abs(generated.summary.endSizeX - 46.5) < 1e-9);
  assert.ok(Math.abs(generated.summary.endSizeY - 96.9) < 1e-9);
  assert.ok(Math.abs(generated.summary.roughSizeX - 46.3) < 1e-9);
  assert.ok(Math.abs(generated.summary.roughSizeY - 96.7) < 1e-9);
  assert.ok(Math.abs(generated.summary.endDepth + 6.8) < 1e-9);
  assert.ok(Math.abs(generated.summary.roughDepth + 6.7) < 1e-9);
  assert.match(generated.content, /; --- Schruppen:/);
  assert.match(generated.content, /G1 Z-6\.7 F1200/);
  assert.match(generated.content, /G0 X0\.1 Y0\.1/);
  assert.match(generated.content, /; --- Schlichten auf ursprüngliches Endmaß ---/);
  assert.match(generated.content, /G1 Z-6\.8 F600/);
  assert.equal(generated.content.match(/; andere Operation/g)?.length, 1);
  assert.equal(generated.content.match(/G0 X100 Y100/g)?.length, 1);
});

test("linearisiert Kreisbögen bei unterschiedlicher X- und Y-Skalierung", () => {
  const source = `G21 G90
G0 X10 Y0
G1 Z-2
G2 I-10 J0 F300
G0 Z5`;
  const parsed = parseGCode(source);
  const generated = createPocketRoughingAndFinishing(source, parsed, [1], {
    allowanceX: 0.5,
    allowanceY: 1,
    allowanceZ: 0.1,
    roughingFeed: 1000,
    finishingFeed: 500,
  });
  const roughing = generated.content.split("; --- Schlichten")[0];
  assert.equal(generated.summary.convertedArcCount, 1);
  assert.ok((roughing.match(/^G1 X/gm)?.length ?? 0) > 50);
  assert.doesNotMatch(roughing, /^G[23](?:\s|X|Y|I|J|R)/m);
  assert.match(generated.content, /G2 I-10 J0 F500/);
});

test("lehnt relative Koordinaten im Taschenblock mit verständlicher Meldung ab", () => {
  const source = "G21 G91\nG0 X0 Y0\nG1 Z-2\nG1 X10\nG1 Y10\nG0 Z5";
  const parsed = parseGCode(source);
  assert.throws(() => createPocketRoughingAndFinishing(source, parsed, [1, 2], {
    allowanceX: 0.1,
    allowanceY: 0.1,
    allowanceZ: 0.1,
    roughingFeed: 1000,
    finishingFeed: 500,
  }), /relative Koordinaten \(G91\)/);
});
