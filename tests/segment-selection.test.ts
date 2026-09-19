import assert from "node:assert/strict";
import test from "node:test";
import type { Path } from "../src/lib/geometry";
import { toggleOverlappingSegment } from "../src/lib/segment-selection";

test("wählt deckungsgleiche Linien nacheinander ab, auch bei umgekehrter Richtung", () => {
  const paths: Path[] = [
    { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    { points: [{ x: 10, y: 0 }, { x: 0, y: 0 }] },
    { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    { points: [{ x: 0, y: 1 }, { x: 10, y: 1 }] },
  ];
  const segments = paths.map((_, pathIndex) => ({ pathIndex, segmentIndex: 0 }));
  let selected = [...segments];
  for (let remaining = 3; remaining >= 1; remaining--) {
    selected = toggleOverlappingSegment(paths, selected, segments[2]);
    assert.equal(selected.length, remaining);
    assert.ok(selected.includes(segments[3]), "Benachbarte Linie bleibt ausgewählt");
  }
  assert.deepEqual(selected, [segments[3]]);
  selected = toggleOverlappingSegment(paths, selected, segments[2]);
  assert.deepEqual(selected, [segments[3], segments[2]]);
});

test("entfernt nur das angeklickte Segment einer mehrteiligen Bahn", () => {
  const paths: Path[] = [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }];
  const first = { pathIndex: 0, segmentIndex: 0 };
  const second = { pathIndex: 0, segmentIndex: 1 };
  assert.deepEqual(toggleOverlappingSegment(paths, [first, second], first), [second]);
});
