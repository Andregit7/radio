import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotationNumbers, annotationsInObservationOrder, convertAnnotationShape, LINE_STYLES } from '../dist/js/annotation-view.js';
import { caseComparisonLayers } from '../dist/js/case-interpretation.js';
import { validateAnnotation } from '../dist/js/schema.js';

const ids = { id: 'a1', imageId: 'primary', itemId: 'f1' };
const validate = (row, version = 2) => validateAnnotation(row, new Set(['primary']), new Set(['f1']), version);

test('long open and closed freehand strokes survive pack validation', () => {
  const points = Array.from({ length: 5000 }, (_, index) => [index / 5000, .5 + Math.sin(index / 100) / 10]);
  for (const shape of ['polyline', 'polygon']) {
    const row = { ...ids, shape, points };
    assert.deepEqual(validate(row).points, points);
  }
  assert.throws(() => validate({ ...ids, shape: 'polyline', points: [[.4, .5], [.4, .5]] }));
  assert.throws(() => validate({ ...ids, shape: 'polygon', points: [[.1, .5], [.2, .5], [.3, .5]] }));
});

test('annotation stroke styles round trip and enforce the allowed widths and values', () => {
  const row = { ...ids, shape: 'rect', x: .2, y: .3, width: .5, height: .4 };
  assert.equal(validate(row, 1).style, undefined);
  for (const line of LINE_STYLES) {
    assert.deepEqual(validate({ ...row, style: { color: '#FFAA00', pattern: 'dots', line, width: 4.5 } }).style,
      { color: '#ffaa00', pattern: 'dots', line, width: 4.5 });
  }
  for (const width of [0, 13, '3', Infinity]) assert.throws(() => validate({ ...row, style: { width } }));
  assert.throws(() => validate({ ...row, style: { line: 'unknown' } }));
});

test('changing shape keeps the linked mark and produces exportable geometry', () => {
  const row = { ...ids, shape: 'ellipse', cx: .4, cy: .5, rx: .1, ry: .2, reviewStatus: 'reviewed',
    style: { color: '#ffa000', pattern: 'dots', line: 'dashed', width: 4 } };
  for (const shape of ['rect', 'arrow', 'polygon', 'polyline']) {
    const converted = validate(convertAnnotationShape(row, shape));
    assert.equal(converted.shape, shape);
    assert.equal(converted.id, row.id);
    assert.equal(converted.itemId, row.itemId);
    assert.equal(converted.reviewStatus, row.reviewStatus);
    assert.equal(converted.style.width, 4);
    assert.equal(converted.style.pattern, ['arrow', 'polyline'].includes(shape) ? 'none' : 'dots');
  }
  const zeroLengthArrow = { ...ids, shape: 'arrow', x1: .9, y1: 1, x2: .9, y2: 1 };
  assert.equal(validate(convertAnnotationShape(zeroLengthArrow, 'polyline')).points.length, 2);
});

test('display numbers follow linked interpretations across the case images', () => {
  const annotations = [
    { id: 'b1', imageId: 'primary', itemId: 'f2' },
    { id: 'a1', imageId: 'primary', itemId: 'f1' },
    { id: 'a2', imageId: 'primary', itemId: 'f1' },
    { id: 'a3', imageId: 'secondary', itemId: 'f1' },
    { id: 'x1', imageId: 'primary', itemId: 'exam' },
  ];
  const sections = [{ id: 'findings', items: [{ id: 'f1' }, { id: 'f2' }] }, { id: 'examination', items: [{ id: 'exam' }] }];
  const item = { sections, annotations };
  assert.deepEqual(annotationsInObservationOrder(item).map(row => row.id), ['x1', 'a1', 'a2', 'a3', 'b1']);
  assert.deepEqual(Object.fromEntries(annotationNumbers(item)), { x1: '1', a1: '2', a2: '3', a3: '4', b1: '5' });
  assert.equal(annotations[0].id, 'b1');
});

test('comparison layers expose annotation IDs only for images in the current case', () => {
  const item = { id: 'c1', images: [{ id: 'original', path: 'images/first.png' }], comparisons: [
    { id: 'local', label: 'Locală', caseId: 'c1', imageId: 'original' },
    { id: 'other', label: 'Exemplu', caseId: 'c2', imageId: 'original' },
  ] };
  const other = { id: 'c2', images: [{ id: 'original', path: 'images/second.png' }] };
  assert.deepEqual(caseComparisonLayers({ cases: [item, other] }, item), [
    { id: 'local', label: 'Locală', path: 'images/first.png', imageId: 'original' },
    { id: 'other', label: 'Exemplu', path: 'images/second.png' },
  ]);
});
