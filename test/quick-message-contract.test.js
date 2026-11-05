const test = require('node:test');
const assert = require('node:assert/strict');
const QuickMessage = require('../src/models/quickMessage.model');
const { quickMessageSchema, QUICK_MESSAGE_MAX_LENGTH } = require('../src/validators/quickMessage.validator');
const { buildReceivedPipeline } = require('../src/services/quickMessage.pipeline');
const c = require('../shared/util/constants.frontcodes');

const userId = '68c490865d8254ec33d4fb5f';
const projectStage = (pipeline) => pipeline.find((stage) => stage.$project).$project;

test('allows only one quick message per sender/recipient pair', () => {
  const pairIndex = QuickMessage.schema.indexes().find(([fields]) => fields.fromUserId === 1 && fields.toUserId === 1);
  assert.equal(pairIndex?.[1].unique, true);
});

test('validates recipient and trimmed content length', () => {
  assert.equal(quickMessageSchema.validate({ toUserId: userId, content: '  Hola!  ' }).error, undefined);
  assert.equal(quickMessageSchema.validate({ toUserId: userId, content: '   ' }).error.details[0].message, c.CODE_CONTENT_REQUIRED);
  assert.equal(
    quickMessageSchema.validate({ toUserId: userId, content: 'x'.repeat(QUICK_MESSAGE_MAX_LENGTH + 1) }).error.details[0].message,
    c.CODE_CONTENT_MAX
  );
  assert.ok(quickMessageSchema.validate({ content: 'hi' }).error);
});

test('never projects message content for non-premium recipients', () => {
  const project = projectStage(buildReceivedPipeline(userId, undefined, false, 20));
  assert.deepEqual(project.content, { $literal: null });
  assert.deepEqual(project.locked, { $literal: true });
});

test('projects message content for premium recipients', () => {
  const project = projectStage(buildReceivedPipeline(userId, undefined, true, 20));
  assert.equal(project.content, '$content');
  assert.deepEqual(project.locked, { $literal: false });
});

test('paginates newest-first with an exclusive cursor and ignores malformed cursors', () => {
  const cursor = '68c490865d8254ec33d4fb60';
  const withCursor = buildReceivedPipeline(userId, cursor, true, 20);
  assert.equal(withCursor[0].$match._id.$lt.toString(), cursor);
  assert.deepEqual(withCursor[1], { $sort: { _id: -1 } });
  assert.deepEqual(withCursor[2], { $limit: 20 });
  assert.equal(buildReceivedPipeline(userId, 'not-an-id', true, 20)[0].$match._id, undefined);
});
