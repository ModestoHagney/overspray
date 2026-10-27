import test from 'node:test';
import assert from 'node:assert/strict';

// engine.js makes its canvases when loaded; nothing here draws, so a stand-in will do
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };

const { createDoc, createFillLayer, serializeDoc, deserializeDoc } = await import('../js/engine.js');

// Three shapes, the first and last in a group "Front". Shapes load without a
// browser Image, so they are what these tests save and load.
function grouped() {
  const doc = createDoc();
  doc.layers = ['#111111', '#222222', '#333333'].map((color, i) => ({ ...createFillLayer(color), id: `S${i + 1}`, name: `s${i + 1}` }));
  doc.groups = [{ id: 'front', name: 'Front', collapsed: false, turn: 30 }];
  doc.layers[0].groupId = doc.layers[2].groupId = 'front';
  return doc;
}
const membership = (doc) => doc.layers.map(l => [l.id, l.groupId]);

test('a new livery has no groups', () => {
  assert.deepEqual(createDoc().groups, []);
});

test('groups and who is in them come back after saving and loading', async () => {
  const back = await deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(grouped()))));
  assert.deepEqual(back.groups, [{ id: 'front', name: 'Front', collapsed: false, turn: 30 }]);
  assert.deepEqual(membership(back), [['S1', 'front'], ['S2', null], ['S3', 'front']]);
});

test('a group left with no layers is dropped, and so is one named twice (the first stays)', async () => {
  const data = serializeDoc(grouped());
  data.groups.push({ id: 'front', name: 'Again', collapsed: true }, { id: 'rear', name: 'Rear' });
  const back = await deserializeDoc(data);
  assert.deepEqual(back.groups.map(g => g.name), ['Front']);
  data.layers = data.layers.filter(l => !l.groupId);
  assert.deepEqual((await deserializeDoc(data)).groups, []);
});

test('a layer naming a group that is not saved ends up in no group', async () => {
  const data = serializeDoc(grouped());
  data.groups = [];
  const back = await deserializeDoc(data);
  assert.deepEqual(back.groups, []);
  assert.ok(back.layers.every(l => l.groupId === null));
});

test('a save from before groups loads every layer, in no group', async () => {
  const data = serializeDoc(grouped());
  delete data.groups;
  data.layers.forEach(l => delete l.groupId);
  const back = await deserializeDoc(data);
  assert.deepEqual(membership(back), [['S1', null], ['S2', null], ['S3', null]]);
  assert.deepEqual(back.groups, []);
});

test('a group without a name is called "Group"; a bad group record is skipped', async () => {
  const data = serializeDoc(grouped());
  data.groups = [null, { name: 'no id' }, { id: 'front', name: '' }];
  assert.deepEqual((await deserializeDoc(data)).groups, [{ id: 'front', name: 'Group', collapsed: false }]);
});
